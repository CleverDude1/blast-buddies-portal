
import { rest, extractList } from './shared.js';
import { SOURCES, BOARDS } from '../_sources/index.js';

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

const EXPECTED_BOARDS = BOARDS.map((b) => b.key);

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const text = (v) => String(v ?? '').slice(0, 220);

// ------------------------------------------------------------
// 1. Collection health
//
// collect.js inserts collection_runs.started_at, but does not
// update finished_at/status/summary. Therefore, determine whether
// a run completed by checking its actual raw_snapshots.
// ------------------------------------------------------------

async function collectorStatus() {
  const now = Date.now();

  const [runsResult, snapshotsResult] = await Promise.all([
    rest(
      'collection_runs?select=id,started_at&order=started_at.desc&limit=12'
    ),
    rest(
      'raw_snapshots?select=run_id,source,fetched_at,http_status&order=fetched_at.desc&limit=100'
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
      reason: 'No collection runs have been recorded yet.',
      lastRunAt: null,
      lastRunStatus: null,
      lastGoodAt: null,
      errors: [],
    };
  }

  const checkedRuns = runs.map((run) => {
    const startedAt = Date.parse(run.started_at);

    const rows = snapshots.filter(
      (snapshot) => snapshot.run_id === run.id
    );

    const saved = new Set(
      rows
        .filter((snapshot) => {
          const status = Number(snapshot.http_status);
          return status >= 200 && status < 300;
        })
        .map((snapshot) => snapshot.source)
    );

    const missing = EXPECTED_BOARDS.filter(
      (key) => !saved.has(key)
    );

    return {
      id: run.id,
      startedAt,
      saved,
      missing,
      count: EXPECTED_BOARDS.length - missing.length,
      complete: missing.length === 0,
    };
  });

  const latest = checkedRuns[0];

  const lastGood =
    checkedRuns.find((run) => run.complete) || null;

  const ageOf = (run) =>
    run ? (now - run.startedAt) / MIN : Infinity;

  const lastGoodAge = ageOf(lastGood);
  const latestAge = ageOf(latest);

  let state = 'ok';
  let reason = 'The latest hourly collection saved all expected boards.';

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
        'No collection has saved all expected boards. The latest run may have failed or timed out.'
      );
    } else {
      bump(
        'warn',
        'The latest collection has started but has not saved all expected boards yet.'
      );
    }
  } else {
    if (lastGoodAge > DOWN_MIN) {
      bump(
        'down',
        `No complete collection for ${Math.round(lastGoodAge / 60 * 10) / 10} hours.`
      );
    } else if (lastGoodAge > OK_MIN) {
      bump(
        'warn',
        `The last complete collection is ${Math.round(lastGoodAge)} minutes old.`
      );
    }

    if (latest.id !== lastGood.id && latestAge > CRASH_MIN) {
      bump(
        'warn',
        `The newest collection is incomplete. Missing: ${latest.missing.join(', ')}.`
      );
    }
  }

  if (latest.complete) {
    reason = lastGoodAge > OK_MIN
      ? `The latest complete collection is ${Math.round(lastGoodAge)} minutes old.`
      : 'The latest hourly collection saved all expected boards.';
  }

  const errors = latest.missing.map((key) => ({
    where: key,
    message: 'No successful snapshot was saved for this board in the latest run.',
  }));

  return {
    state,
    title: TITLE[state],
    reason,
    lastRunAt: iso(latest.startedAt),
    lastRunStatus: latest.complete
      ? 'ok'
      : latest.count > 0
        ? 'partial'
        : 'incomplete',
    lastGoodAt: iso(lastGood?.startedAt ?? null),
    errors,
  };
}

// ------------------------------------------------------------
// 2. New API live check
//
// The first configured source is the combined Pangolin API.
// Validate its response against every board in BOARDS.
// ------------------------------------------------------------

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'cache-control': 'no-cache',
        'user-agent': 'blast-buddies-status-check',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`No answer within ${timeoutMs / 1000} seconds`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function checkCombinedSource() {
  const source = SOURCES[0];

  if (!source?.url) {
    return {
      state: 'down',
      good: 0,
      total: EXPECTED_BOARDS.length,
      errors: [{
        where: 'Pangolin',
        message: 'The primary combined API source is not configured.',
      }],
    };
  }

  try {
    const json = await fetchJson(source.url);

    if (json?.metadata?.stale === true) {
      throw new Error('The combined API returned a stale snapshot.');
    }

    const errors = [];

    for (const board of BOARDS) {
      try {
        const rows = board.pick(json);

        if (!Array.isArray(rows) || rows.length === 0) {
          errors.push({
            where: board.key,
            message: 'The combined API answered, but this board was empty or missing.',
          });
        }
      } catch (error) {
        errors.push({
          where: board.key,
          message: text(error.message || error),
        });
      }
    }

    const total = EXPECTED_BOARDS.length;
    const good = total - errors.length;

    return {
      state: good === total
        ? 'ok'
        : good > 0
          ? 'warn'
          : 'down',
      good,
      total,
      errors,
    };
  } catch (error) {
    return {
      state: 'down',
      good: 0,
      total: EXPECTED_BOARDS.length,
      errors: [{
        where: 'Pangolin',
        message: text(error.message || error),
      }],
    };
  }
}

// ------------------------------------------------------------
// 3. Old API live check
//
// Retains the original direct game-server checks.
// This is only the legacy fallback indicator.
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
  try {
    const json = await fetchJson(url, 6000);
    const rows = extractList(json, idKey);

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Answered, but returned no rows.');
    }

    return null;
  } catch (error) {
    return text(error.message || error);
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
// 4. Cached live checks
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
// 5. New API status
// ------------------------------------------------------------

async function newApi() {
  const [live, collection] = await Promise.all([
    cachedCheck('new', checkCombinedSource),
    collectorStatus().catch((error) => ({
      state: 'warn',
      title: TITLE.warn,
      reason: `Could not read collection history: ${text(error.message || error)}`,
      lastRunAt: null,
      lastRunStatus: null,
      lastGoodAt: null,
      errors: [],
    })),
  ]);

  let state = live.state;
  let reason;

  if (live.state === 'ok') {
    reason = 'The combined Pangolin API is answering and all four boards contain data.';
  } else if (live.state === 'warn') {
    reason = `The combined Pangolin API is answering, but only ${live.good} of ${live.total} boards contain data.`;
  } else {
    reason = 'The combined Pangolin API is not answering with usable board data.';
  }

  // A working live API with collection problems is still working,
  // but receives the warning state.
  if (live.state === 'ok' && collection.state !== 'ok') {
    state = 'warn';
    reason = `The combined API is working, but hourly collection has problems: ${collection.reason}`;
  }

  return {
    state,
    title: TITLE[state],
    reason,
    lastRunAt: collection.lastRunAt,
    lastRunStatus: collection.lastRunStatus,
    lastGoodAt: collection.lastGoodAt,
    errors: live.errors.length
      ? live.errors
      : collection.errors,
  };
}

// ------------------------------------------------------------
// 6. Old API status
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
// 7. Public status endpoint
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
