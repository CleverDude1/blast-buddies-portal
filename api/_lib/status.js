
import { rest, extractList } from './shared.js';

const MIN = 60 * 1000;
const OK_MIN = 75;
const DOWN_MIN = 150;
const CRASH_MIN = 15;
const TTL = 2 * MIN;

const cache = {};

const LEVEL = { ok: 0, warn: 1, down: 2 };

const TITLE = {
  ok: 'Working',
  warn: 'Working with problems',
  down: 'Not working',
};

const EXPECTED_BOARDS = [
  'leaderboard-day',
  'leaderboard-week',
  'leaderboard-ranked',
  'clan',
];

const iso = (ms) => (
  ms == null || !Number.isFinite(ms)
    ? null
    : new Date(ms).toISOString()
);

const text = (value) => String(value ?? '').slice(0, 220);

// ------------------------------------------------------------
// 1. NEW API / HOURLY COLLECTION STATUS
//
// IMPORTANT:
// This function does NOT contact Pangolin.
//
// It checks the snapshots already stored by collect.js.
// The collector runs once per hour, so the status page can
// refresh as often as it wants without using Pangolin requests.
// ------------------------------------------------------------

async function collectorStatus() {
  const now = Date.now();

  const [runsResult, snapshotsResult] = await Promise.all([
    rest(
      'collection_runs?select=id,started_at&order=started_at.desc&limit=12'
    ),
    rest(
      'raw_snapshots?select=run_id,source,fetched_at,http_status&order=fetched_at.desc&limit=200'
    ),
  ]);

  const runs = Array.isArray(runsResult) ? runsResult : [];
  const snapshots = Array.isArray(snapshotsResult)
    ? snapshotsResult
    : [];

  if (!runs.length) {
    return {
      state: 'warn',
      title: TITLE.warn,
      reason: 'No hourly collection runs have been recorded yet.',
      lastRunAt: null,
      lastRunStatus: null,
      lastGoodAt: null,
      errors: [],
    };
  }

  const checkedRuns = runs.map((run) => {
    const startedAt = Date.parse(run.started_at);

    const runSnapshots = snapshots.filter(
      (snapshot) => String(snapshot.run_id) === String(run.id)
    );

    const saved = new Set(
      runSnapshots
        .filter((snapshot) => {
          const status = Number(snapshot.http_status);
          return status >= 200 && status < 300;
        })
        .map((snapshot) => snapshot.source)
    );

    const missing = EXPECTED_BOARDS.filter(
      (board) => !saved.has(board)
    );

    return {
      id: run.id,
      startedAt,
      saved,
      missing,
      complete: missing.length === 0,
    };
  });

  const latest = checkedRuns[0];

  const lastGood =
    checkedRuns.find((run) => run.complete) || null;

  const ageMinutes = (run) => (
    run && Number.isFinite(run.startedAt)
      ? (now - run.startedAt) / MIN
      : Infinity
  );

  const latestAge = ageMinutes(latest);
  const lastGoodAge = ageMinutes(lastGood);

  let state = 'ok';
  let reason = 'The latest hourly collection saved all four boards.';

  const bump = (nextState, message) => {
    if (LEVEL[nextState] > LEVEL[state]) {
      state = nextState;
      reason = message;
    }
  };

  if (!lastGood) {
    if (latestAge > CRASH_MIN) {
      bump(
        'down',
        'No complete hourly collection has been recorded. The latest run may have failed or timed out.'
      );
    } else {
      bump(
        'warn',
        'The latest hourly collection has started but has not saved all four boards yet.'
      );
    }
  } else {
    if (lastGoodAge > DOWN_MIN) {
      bump(
        'down',
        `No complete hourly collection for ${Math.round(lastGoodAge / 60 * 10) / 10} hours.`
      );
    } else if (lastGoodAge > OK_MIN) {
      bump(
        'warn',
        `The last complete hourly collection is ${Math.round(lastGoodAge)} minutes old.`
      );
    }

    if (!latest.complete && latestAge > CRASH_MIN) {
      bump(
        'warn',
        `The latest collection is incomplete. Missing boards: ${latest.missing.join(', ')}.`
      );
    }
  }

  const errors = latest.missing.map((board) => ({
    where: board,
    message: 'No successful snapshot was saved for this board in the latest run.',
  }));

  return {
    state,
    title: TITLE[state],
    reason,
    lastRunAt: iso(latest.startedAt),
    lastRunStatus: latest.complete
      ? 'ok'
      : latest.saved.size > 0
        ? 'partial'
        : 'incomplete',
    lastGoodAt: iso(lastGood?.startedAt ?? null),
    errors,
  };
}

// ------------------------------------------------------------
// 2. CACHED CHECKS
// ------------------------------------------------------------

async function cachedCheck(key, fn) {
  if (
    cache[key] &&
    Date.now() - cache[key].time < TTL
  ) {
    return cache[key].value;
  }

  const value = await fn();

  cache[key] = {
    time: Date.now(),
    value,
  };

  return value;
}

// ------------------------------------------------------------
// 3. NEW API STATUS
//
// Supabase only. No direct Pangolin requests.
//
// This reports whether the hourly collection is saving fresh
// data. It does not independently identify which upstream
// source supplied the snapshots.
// ------------------------------------------------------------

async function newApi() {
  const collection = await cachedCheck(
    'collection',
    collectorStatus
  );

  return {
    state: collection.state,
    title: collection.title,
    reason: collection.reason,
    lastRunAt: collection.lastRunAt,
    lastRunStatus: collection.lastRunStatus,
    lastGoodAt: collection.lastGoodAt,
    errors: collection.errors,
  };
}

// ------------------------------------------------------------
// 4. OLD API STATUS
//
// Retains the original direct game-server checks.
// These requests do not contact Pangolin.
// ------------------------------------------------------------

const SEASON = encodeURIComponent(
  process.env.RANKED_SEASON || 3
);

const NA = 'https://na1-ping.blastbuddies.io/api/leaderboard';
const EU = 'https://eu1-ping.blastbuddies.io/api/leaderboard';

const OLD_BOARDS = [
  {
    name: 'Daily',
    idKey: 'playerId',
    urls: [`${EU}/day`],
  },
  {
    name: 'Weekly',
    idKey: 'playerId',
    urls: [`${EU}/week`],
  },
  {
    name: 'Ranked',
    idKey: 'playerId',
    urls: [`${NA}/ranked?season=${SEASON}`],
  },
  {
    name: 'Clans',
    idKey: 'clanId',
    urls: [`${EU}/clans`],
  },
];

async function probeUrl(url, idKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);

  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'cache-control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    const rows = extractList(json, idKey);

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Answered, but returned no rows.');
    }

    return null;
  } catch (error) {
    return error.name === 'AbortError'
      ? 'No answer within 6 seconds.'
      : text(error.message || error);
  } finally {
    clearTimeout(timer);
  }
}

async function checkOldApi() {
  const results = await Promise.all(
    OLD_BOARDS.map(async (board) => {
      let error = null;

      for (const url of board.urls) {
        error = await probeUrl(url, board.idKey);
        if (!error) break;
      }

      return { board, error };
    })
  );

  const good = results.filter((result) => !result.error).length;
  const total = results.length;

  return {
    state: good === total
      ? 'ok'
      : good > 0
        ? 'warn'
        : 'down',
    good,
    total,
    errors: results
      .filter((result) => result.error)
      .map((result) => ({
        where: result.board.name,
        message: result.error,
      })),
  };
}

// ------------------------------------------------------------
// 5. OLD API STATUS RESPONSE
// ------------------------------------------------------------

async function oldApi() {
  const live = await cachedCheck('old', checkOldApi);

  let reason;

  if (live.state === 'ok') {
    reason = 'The old direct game API is answering for all four boards.';
  } else if (live.state === 'warn') {
    reason = `Only ${live.good} of ${live.total} old API boards are answering.`;
  } else {
    reason = 'The old direct game API is not answering with usable board data.';
  }

  return {
    state: live.state,
    title: TITLE[live.state],
    reason,
    lastRunAt: null,
    lastRunStatus: null,
    lastGoodAt: null,
    errors: live.errors,
  };
}

// ------------------------------------------------------------
// 6. PUBLIC STATUS ENDPOINT
// ------------------------------------------------------------

export async function apiStatus() {
  const [newResult, oldResult] = await Promise.allSettled([
    newApi(),
    oldApi(),
  ]);

  const unknown = (error) => ({
    state: 'unknown',
    title: 'Status unavailable',
    reason: text(error?.message || 'The status check failed.'),
    lastRunAt: null,
    lastRunStatus: null,
    lastGoodAt: null,
    errors: [],
  });

  return {
    generatedAt: new Date().toISOString(),

    new: newResult.status === 'fulfilled'
      ? newResult.value
      : unknown(newResult.reason),

    old: oldResult.status === 'fulfilled'
      ? oldResult.value
      : unknown(oldResult.reason),
  };
}
