import { recordPlayerUpdates } from './_lib/player-updates.js';
import { recordClanUpdates } from './_lib/clan-updates.js';
import { collect as collectRecords, commit as commitRecords, hourAgo } from './_lib/records.js';
import { collectPerformance, commitPerformance } from './_lib/performance.js';
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

const STORE_RAW = process.env.STORE_RAW !== 'false';

// FALLBACK: when the combined (new) API does not deliver a board, that board is fetched straight from the game's own server,
// the same addresses the old api/leaderboard-week.js, leaderboard-ranked.js and clan.js proxies used. Nothing on your own site is called,
// so those three files (and the old daily one) no longer need to exist, which frees function slots.
//   - there is no daily fallback: that address is gone, so a missing daily board just stays missing for that hour
//   - a board can also set `fallbackUrl` in api/_sources/index.js to override the address below
//   - set FALLBACK_ENABLED=false in Vercel to switch it off
const FALLBACK_ENABLED = process.env.FALLBACK_ENABLED !== 'false';
const FALLBACK_URLS = {
  'leaderboard-week':   () => 'https://eu1-ping.blastbuddies.io/api/leaderboard/week',
  'leaderboard-ranked': (b) => `https://na1-ping.blastbuddies.io/api/leaderboard/ranked?season=${encodeURIComponent(b.season ?? 3)}`,
  'clan':               () => 'https://eu1-ping.blastbuddies.io/api/leaderboard/clans',
};
const fallbackUrlFor = (b) => b.fallbackUrl || FALLBACK_URLS[b.key]?.(b) || null;

async function fetchJson(url, tries = 3, timeoutMs = 20000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'blast-buddies-collector', 'cache-control': 'no-cache' },
      });
      if (res.status === 429 || res.status === 503) {   // rate limited / no snapshot: retrying now would not help
        const err = new Error(`HTTP ${res.status} (retry after ${res.headers.get('Retry-After') || '?'}s)`); err.noRetry = true; throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, json: await res.json() };
    } catch (e) {
      lastErr = e;
      if (e.noRetry || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export default async function handler(req, res) {
  // Vercel cron sends "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is set.
  const secret = process.env.YOUR_ACTUAL_CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'YOUR_ACTUAL_CRON_SECRET is not set' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date().toISOString();
  const { data: run, error: runErr } = await db
    .from('collection_runs')
    .insert({ started_at: now })
    .select('id')
    .single();
  if (runErr) return res.status(500).json({ error: `could not create run: ${runErr.message}` });

  const errors = [];
  const summary = {};

  const players = new Map();
  const clans = new Map();
  const lifetime = new Map();   // playerId -> lifetime stats + per-weapon kills (saved to player_lifetime / player_weapon_stats)
  const entriesBySource = [];
  const boards = []; // used by the records step
  const got = new Set();        // board keys that were stored this run (from the new API or the fallback)
  const via = {};               // board key -> 'primary' | 'fallback'
  let fetchedOk = 0;
  let bundle = null;            // the whole Pangolin response (clan archives are read from it)

  // Store one board: raw snapshot + feed it to the ingest step. Used for both the new API and the fallback,
  // so a board is only ever stored when it holds real rows (an empty or error response is never saved as a snapshot).
  async function accept(b, season, top, status, how) {
    // Same shape the old APIs returned ({ data: { top: [...] } }), so records.js and the diffs don't change.
    // `payload` (full rows) feeds the records step; the copy stored in raw_snapshots drops stats + weaponStats to keep the table small.
    // records.js writes "Season N" from payload.season, so the season travels with the payload.
    const payload = { season, data: { top } };
    const stored = { season, data: { top: top.map(({ stats, weaponStats, ...row }) => row) } };

    if (STORE_RAW) {
      const { error } = await db.from('raw_snapshots').insert({
        run_id: run.id, source: b.key, url: b.url, http_status: status, fetched_at: now, payload: stored,
      });
      if (error) errors.push({ source: b.key, step: 'raw', error: error.message });
    }

    summary[b.key] = { rows: top.length, via: how };
    boards.push({ b, payload });
    got.add(b.key);
    via[b.key] = how;

    if (b.type === 'leaderboard') {
      const entries = [];
      const src = { key: b.key, board: b.board, season };
      ingestLeaderboard(src, top, players, entries, lifetime);
      entriesBySource.push({ s: src, entries });
    } else {
      ingestClans(top, clans);
    }
  }

  // 1. Fetch the combined API
  const results = await Promise.allSettled(SOURCES.map((s) => fetchJson(s.url)));

  // 2. Cut it into boards, store raw slices, ingest
  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const r = results[i];
    if (r.status === 'rejected') {
      errors.push({ source: s.key, error: String(r.reason?.message || r.reason) });
      continue;
    }
    const { json, status } = r.value;
    if (json?.metadata?.stale === true) {
      errors.push({ source: s.key, error: 'upstream snapshot is stale, skipped' });
      continue;
    }
    fetchedOk++;
    bundle = json;

    for (const b of BOARDS) {
      const top = b.pick(json);
      if (!Array.isArray(top) || !top.length) {
        errors.push({ source: b.key, error: 'board missing or empty in bundle' });
        continue;
      }
      const season = b.board === 'ranked'
        ? (json.ranked?.current?.season ?? json.metadata?.currentSeason ?? b.season)
        : b.season;
      await accept(b, season, top, status, 'primary');
    }
  }

  // 2b. Fallback: every board the new API did not deliver is fetched from the old per-board API
  if (FALLBACK_ENABLED) {
    const missing = BOARDS.filter((b) => !got.has(b.key) && fallbackUrlFor(b));
    if (missing.length) {
      const fb = await Promise.allSettled(missing.map((b) => fetchJson(fallbackUrlFor(b), 2, 10000)));
      for (let i = 0; i < missing.length; i++) {
        const b = missing[i], r = fb[i];
        try {
          if (r.status === 'rejected') throw r.reason;
          const { json, status } = r.value;
          if (json?.metadata?.stale === true) throw new Error('fallback snapshot is stale');
          const top = extractList(json?.data ?? json, b.type === 'clans' ? 'clanId' : 'playerId');
          if (!Array.isArray(top) || !top.length) throw new Error('fallback returned no rows');
          const season = json?.season ?? b.season;
          await accept(b, season, top, status, 'fallback');
        } catch (e) {
          errors.push({ source: b.key, step: 'fallback', error: String(e?.message || e) });
        }
      }
    }
    // a "board missing" note for a board the fallback then stored is kept in the log but no longer counts as a failure
    errors.forEach((e) => { if (!e.step && got.has(e.source)) e.recovered = true; });
    // if every board ended up stored, the whole-fetch failure notes are recovered too
    if (got.size === BOARDS.length) errors.forEach((e) => { if (!e.step) e.recovered = true; });
  }
  summary.sources = { primary: Object.keys(via).filter((k) => via[k] === 'primary'), fallback: Object.keys(via).filter((k) => via[k] === 'fallback') };

  // 3. Change-detect + store
  const step = async (name, fn) => {
    try { summary[name] = await fn(); }
    catch (e) { errors.push({ step: name, error: e.message }); }
  };

  await step('players', () =>
    syncEntities(db, {
      table: 'players', historyTable: 'player_history', keyCols: ['player_id'],
      tracked: PLAYER_TRACKED, rows: [...players.values()], runId: run.id, now,
    }));

  await step('lifetime', () => saveLifetime(db, lifetime, now));
  // clan archives only come with the combined API, so this is skipped when only the fallback ran
  if (bundle) await step('monthlyKills', () => saveMonthlyKills(db, bundle?.clans?.archives, now));

  for (const { s, entries } of entriesBySource) {
    await step(`board:${s.key}`, () =>
      syncEntities(db, {
        table: 'leaderboard_state', historyTable: 'leaderboard_history',
        keyCols: ['board', 'season', 'player_id'], tracked: ENTRY_TRACKED,
        rows: entries, runId: run.id, now, scope: { board: s.board, season: s.season },
      }));
  }

  await step('clans', () =>
    syncEntities(db, {
      table: 'clans', historyTable: 'clan_history', keyCols: ['clan_id'],
      tracked: CLAN_TRACKED, rows: [...clans.values()], runId: run.id, now,
    }));
  await step('clanUpdates', () => recordClanUpdates());
  await step('playerUpdates', () => recordPlayerUpdates());

  // Statistics page records (all-time highs, best KDR, biggest gain in 1 hour). Compares each board with the snapshot from ~1 hour ago.
  // The same items also feed the Player Performance records (perf_records), so the 1-hour snapshots are only fetched once.
  await step('records', async () => {
    const nowMs = Date.parse(now), items = [];
    for (const { b, payload } of boards) {
      let prev = null;
      try { prev = await hourAgo(b.url, nowMs); } catch (e) { /* no earlier snapshot: the 1-hour gains are skipped for this board */ }
      items.push({ board: b.board, payload, at: nowMs, prevPayload: prev?.payload, prevAt: prev?.at });
    }
    await commitRecords(collectRecords(items), nowMs);
    let performance = null;
    try { performance = await commitPerformance(collectPerformance(items)); }   // a failure here never blocks the Statistics records
    catch (e) { errors.push({ step: 'performance', error: e.message }); }
    return { boards: items.length, performance };
  });

  // 4. Close out the run
  const real = errors.filter((e) => !e.recovered);
  const status = real.length === 0 ? 'ok' : got.size > 0 ? 'partial' : 'failed';
  await db.from('collection_runs')
    .update({ finished_at: new Date().toISOString(), status, summary, errors })
    .eq('id', run.id);

  return res.status(status === 'failed' ? 500 : 200).json({ runId: run.id, status, summary, errors });
}
