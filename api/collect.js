
import { recordPlayerUpdates } from './_lib/player-updates.js';
import { recordClanUpdates } from './_lib/clan-updates.js';
import {
  collect as collectRecords,
  commit as commitRecords,
  hourAgo,
} from './_lib/records.js';
import {
  collectPerformance,
  commitPerformance,
} from './_lib/performance.js';
import { createClient } from '@supabase/supabase-js';
import { SOURCES, BOARDS } from './_sources/index.js';
import { extractList } from './_lib/shared.js';
import {
  ingestLeaderboard,
  ingestClans,
  saveLifetime,
  saveMonthlyKills,
  syncEntities,
  PLAYER_TRACKED,
  ENTRY_TRACKED,
  CLAN_TRACKED,
} from './_lib/sync.js';

// Give Vercel more time for multiple upstream API calls.
export const config = { maxDuration: 60 };

const STORE_RAW = process.env.STORE_RAW !== 'false';
const FALLBACK_ENABLED = process.env.FALLBACK_ENABLED !== 'false';

const FALLBACK_URLS = {
  'leaderboard-day': () =>
    'https://eu1-ping.blastbuddies.io/api/leaderboard/day',

  'leaderboard-week': () =>
    'https://eu1-ping.blastbuddies.io/api/leaderboard/week',

  'leaderboard-ranked': (b) =>
    `https://na1-ping.blastbuddies.io/api/leaderboard/ranked?season=${encodeURIComponent(b.season ?? 3)}`,

  clan: () =>
    'https://eu1-ping.blastbuddies.io/api/leaderboard/clans',
};

const fallbackUrlFor = (b) =>
  b.fallbackUrl || FALLBACK_URLS[b.key]?.(b) || null;

async function fetchJson(url, tries = 3, timeoutMs = 20000) {
  let lastErr;

  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'user-agent': 'blast-buddies-collector',
          'cache-control': 'no-cache',
        },
      });

      if (res.status === 429 || res.status === 503) {
        const err = new Error(
          `HTTP ${res.status} (retry after ${res.headers.get('Retry-After') || '?'}s)`
        );
        err.noRetry = true;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return {
        status: res.status,
        json: await res.json(),
      };
    } catch (e) {
      lastErr = e;

      if (e.noRetry || i === tries - 1) {
        break;
      }

      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

export default async function handler(req, res) {
  // Supabase Cron sends the Authorization header configured in its Vault secret.
  const secret = process.env.YOUR_ACTUAL_CRON_SECRET;

  if (!secret) {
    return res.status(500).json({
      error: 'YOUR_ACTUAL_CRON_SECRET is not set',
    });
  }

  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false },
    }
  );

  const now = new Date().toISOString();

  const { data: run, error: runErr } = await db
    .from('collection_runs')
    .insert({ started_at: now })
    .select('id')
    .single();

  if (runErr) {
    return res.status(500).json({
      error: `could not create run: ${runErr.message}`,
    });
  }

  const errors = [];
  const summary = {};

  const players = new Map();
  const clans = new Map();
  const lifetime = new Map();

  const entriesBySource = [];
  const boards = [];

  const got = new Set();
  const via = {};

  let fetchedOk = 0;
  let bundle = null;

  // Store one board and feed it into the ingestion process.
  async function accept(b, season, top, status, how) {
    const payload = {
      season,
      data: { top },
    };

    const stored = {
      season,
      data: {
        top: top.map(({ stats, weaponStats, ...row }) => row),
      },
    };

    if (STORE_RAW) {
      const { error } = await db.from('raw_snapshots').insert({
        run_id: run.id,
        source: b.key,
        url: b.url,
        http_status: status,
        fetched_at: now,
        payload: stored,
      });

      if (error) {
        errors.push({
          source: b.key,
          step: 'raw',
          error: error.message,
        });
      }
    }

    summary[b.key] = {
      rows: top.length,
      via: how,
    };

    boards.push({ b, payload });
    got.add(b.key);
    via[b.key] = how;

    if (b.type === 'leaderboard') {
      const entries = [];

      const src = {
        key: b.key,
        board: b.board,
        season,
      };

      ingestLeaderboard(
        src,
        top,
        players,
        entries,
        lifetime
      );

      entriesBySource.push({
        s: src,
        entries,
      });
    } else {
      ingestClans(top, clans);
    }
  }

  // 1. Try sources in order: Pangolin first, then backup.
  for (
    let i = 0;
    i < SOURCES.length && got.size < BOARDS.length;
    i++
  ) {
    const s = SOURCES[i];
    let r;

    try {
      r = await fetchJson(s.url, 2, 12000);
    } catch (e) {
      errors.push({
        source: s.key,
        error: String(e?.message || e),
      });
      continue;
    }

    const { json, status } = r;

    if (json?.metadata?.stale === true) {
      errors.push({
        source: s.key,
        error: 'upstream snapshot is stale, skipped',
      });
      continue;
    }

    fetchedOk++;

    if (!bundle?.clans?.archives) {
      bundle = json;
    }

    for (const b of BOARDS) {
      if (got.has(b.key)) continue;

      const top = b.pick(json);

      if (!Array.isArray(top) || !top.length) {
        errors.push({
          source: s.key,
          board: b.key,
          error: 'board missing or empty in bundle',
        });
        continue;
      }

      const season =
        b.board === 'ranked'
          ? (
              json.ranked?.current?.season ??
              json.metadata?.currentSeason ??
              b.season
            )
          : b.season;

      await accept(
        b,
        season,
        top,
        status,
        i === 0 ? 'primary' : 'backup'
      );
    }
  }

  // 2. Last-resort direct game API fallback.
  if (FALLBACK_ENABLED) {
    const missing = BOARDS.filter(
      (b) => !got.has(b.key) && fallbackUrlFor(b)
    );

    if (missing.length) {
      const fb = await Promise.allSettled(
        missing.map((b) =>
          fetchJson(fallbackUrlFor(b), 2, 10000)
        )
      );

      for (let i = 0; i < missing.length; i++) {
        const b = missing[i];
        const r = fb[i];

        try {
          if (r.status === 'rejected') {
            throw r.reason;
          }

          const { json, status } = r.value;

          if (json?.metadata?.stale === true) {
            throw new Error('fallback snapshot is stale');
          }

          const top = extractList(
            json?.data ?? json,
            b.type === 'clans' ? 'clanId' : 'playerId'
          );

          if (!Array.isArray(top) || !top.length) {
            throw new Error('fallback returned no rows');
          }

          const season = json?.season ?? b.season;

          await accept(
            b,
            season,
            top,
            status,
            'fallback'
          );
        } catch (e) {
          errors.push({
            source: b.key,
            step: 'fallback',
            error: String(e?.message || e),
          });
        }
      }
    }
  }

  // Mark recovered source errors.
  errors.forEach((e) => {
    if (!e.step && e.board && got.has(e.board)) {
      e.recovered = true;
    }
  });

  if (got.size === BOARDS.length) {
    errors.forEach((e) => {
      if (!e.step) {
        e.recovered = true;
      }
    });
  }

  summary.sources = {
    primary: Object.keys(via).filter(
      (k) => via[k] === 'primary'
    ),
    backup: Object.keys(via).filter(
      (k) => via[k] === 'backup'
    ),
    fallback: Object.keys(via).filter(
      (k) => via[k] === 'fallback'
    ),
  };

  // Run a collection step without stopping the remaining steps
  // if one individual step fails.
  const step = async (name, fn) => {
    try {
      summary[name] = await fn();
    } catch (e) {
      errors.push({
        step: name,
        error: String(e?.message || e),
      });
    }
  };

  // 3. Sync players.
  await step('players', () =>
    syncEntities(db, {
      table: 'players',
      historyTable: 'player_history',
      keyCols: ['player_id'],
      tracked: PLAYER_TRACKED,
      rows: [...players.values()],
      runId: run.id,
      now,
    })
  );

  // 4. Save lifetime statistics.
  await step('lifetime', () =>
    saveLifetime(db, lifetime, now)
  );

  // 5. Save monthly kills from clan archives.
  if (bundle?.clans?.archives) {
    await step('monthlyKills', () =>
      saveMonthlyKills(db, bundle.clans.archives, now)
    );
  }

  // 6. Sync leaderboard history.
  for (const { s, entries } of entriesBySource) {
    await step(`board:${s.key}`, () =>
      syncEntities(db, {
        table: 'leaderboard_state',
        historyTable: 'leaderboard_history',
        keyCols: ['board', 'season', 'player_id'],
        tracked: ENTRY_TRACKED,
        rows: entries,
        runId: run.id,
        now,
        scope: {
          board: s.board,
          season: s.season,
        },
      })
    );
  }

  // 7. Sync clans.
  await step('clans', () =>
    syncEntities(db, {
      table: 'clans',
      historyTable: 'clan_history',
      keyCols: ['clan_id'],
      tracked: CLAN_TRACKED,
      rows: [...clans.values()],
      runId: run.id,
      now,
    })
  );

  // 8. Record player and clan updates.
  await step('clanUpdates', () =>
    recordClanUpdates()
  );

  await step('playerUpdates', () =>
    recordPlayerUpdates()
  );

  // 9. Build previous-snapshot comparisons once.
  // Both records systems use this exact same items array.
  const recordItems = [];

  await step('previousSnapshots', async () => {
    const nowMs = Date.parse(now);

    for (const { b, payload } of boards) {
      let prev = null;

      try {
        prev = await hourAgo(b.url, nowMs);
      } catch (e) {
        errors.push({
          source: b.key,
          step: 'hourAgo',
          error: String(e?.message || e),
        });
      }

      const boardName =
        b.board ||
        ({
          'leaderboard-day': 'day',
          'leaderboard-week': 'week',
          'leaderboard-ranked': 'ranked',
          clan: 'clan',
        })[b.key];

      recordItems.push({
        board: boardName,
        payload,
        at: nowMs,
        prevPayload: prev?.payload ?? null,
        prevAt: prev?.at ?? null,
      });
    }

    return {
      boardsCompared: recordItems.length,
    };
  });

  // 10. Statistics page records.
  await step('records', async () => {
    const acc = collectRecords(recordItems);

    await commitRecords(acc, Date.parse(now));

    return {
      boards: recordItems.length,
      recordTypes: Object.keys(acc.best).length,
      level100Players: acc.l100.size,
    };
  });

  // 11. Player Performance records.
  await step('performance', async () => {
    const acc = collectPerformance(recordItems);

    const result = await commitPerformance(acc);

    return result;
  });

  // 12. Final collection response.
  const failed = errors.some((e) => !e.recovered);

  const result = {
    ok: got.size > 0,
    runId: run.id,
    fetchedOk,
    boards: summary,
    errors,
  };

  console.log(
    'Blast Buddies collection completed:',
    JSON.stringify(result)
  );

  return res.status(failed ? 207 : 200).json(result);
}
