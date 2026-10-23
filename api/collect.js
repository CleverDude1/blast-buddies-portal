import { recordPlayerUpdates } from './_lib/player-updates.js';
import { recordClanUpdates } from './_lib/clan-updates.js';
import { collect as collectRecords, commit as commitRecords, hourAgo } from './_lib/records.js';
import { createClient } from '@supabase/supabase-js';
import { SOURCES, BOARDS } from './_sources/index.js';
import {
  ingestLeaderboard,
  ingestClans,
  saveLifetime,
  syncEntities,
  PLAYER_TRACKED,
  ENTRY_TRACKED,
  CLAN_TRACKED,
} from './_lib/sync.js';

const STORE_RAW = process.env.STORE_RAW !== 'false';

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'blast-buddies-collector', 'cache-control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, json: await res.json() };
    } catch (e) {
      lastErr = e;
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

  // 1. Fetch the combined API
  const results = await Promise.allSettled(SOURCES.map((s) => fetchJson(s.url)));

  // 2. Cut it into boards, store raw slices, ingest
  const players = new Map();
  const clans = new Map();
  const lifetime = new Map();   // playerId -> lifetime stats + per-weapon kills (saved to player_lifetime / player_weapon_stats)
  const entriesBySource = [];
  const boards = []; // used by the records step
  let fetchedOk = 0;

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

    for (const b of BOARDS) {
      const top = b.pick(json);
      if (!Array.isArray(top) || !top.length) {
        errors.push({ source: b.key, error: 'board missing or empty in bundle' });
        continue;
      }
      // Same shape the old APIs returned ({ data: { top: [...] } }), so records.js and the diffs don't change.
      // `payload` (full rows) feeds the records step; the copy stored in raw_snapshots drops stats + weaponStats to keep the table small.
      const payload = { data: { top } };
      const stored = { data: { top: top.map(({ stats, weaponStats, ...row }) => row) } };
      const season = b.board === 'ranked'
        ? (json.ranked?.current?.season ?? json.metadata?.currentSeason ?? b.season)
        : b.season;

      if (STORE_RAW) {
        const { error } = await db.from('raw_snapshots').insert({
          run_id: run.id, source: b.key, url: b.url, http_status: status, fetched_at: now, payload: stored,
        });
        if (error) errors.push({ source: b.key, step: 'raw', error: error.message });
      }

      summary[b.key] = { rows: top.length };
      boards.push({ b, payload });

      if (b.type === 'leaderboard') {
        const entries = [];
        const src = { key: b.key, board: b.board, season };
        ingestLeaderboard(src, top, players, entries, lifetime);
        entriesBySource.push({ s: src, entries });
      } else {
        ingestClans(top, clans);
      }
    }
  }

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
  await step('records', async () => {
    const nowMs = Date.parse(now), items = [];
    for (const { b, payload } of boards) {
      let prev = null;
      try { prev = await hourAgo(b.url, nowMs); } catch (e) { /* no earlier snapshot: the 1-hour gains are skipped for this board */ }
      items.push({ board: b.board, payload, at: nowMs, prevPayload: prev?.payload, prevAt: prev?.at });
    }
    await commitRecords(collectRecords(items), nowMs);
    return { boards: items.length };
  });

  // 4. Close out the run
  const status = errors.length === 0 ? 'ok' : fetchedOk > 0 ? 'partial' : 'failed';
  await db.from('collection_runs')
    .update({ finished_at: new Date().toISOString(), status, summary, errors })
    .eq('id', run.id);

  return res.status(status === 'failed' ? 500 : 200).json({ runId: run.id, status, summary, errors });
}
