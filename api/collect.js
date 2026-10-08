import { createClient } from '@supabase/supabase-js';
import { SOURCES } from './_sources/index.js';
import {
  extractList,
  ingestLeaderboard,
  ingestClans,
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
  const secret = process.env.YOU_ACTUAL_CRON_SECRET;
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

  // 1. Fetch every source in parallel
  const results = await Promise.allSettled(SOURCES.map((s) => fetchJson(s.url)));

  // 2. Parse + store raw
  const players = new Map();
  const clans = new Map();
  const entriesBySource = [];
  let fetchedOk = 0;

  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const r = results[i];
    if (r.status === 'rejected') {
      errors.push({ source: s.key, error: String(r.reason?.message || r.reason) });
      continue;
    }
    fetchedOk++;
    const { json, status } = r.value;

    if (STORE_RAW) {
      const { error } = await db.from('raw_snapshots').insert({
        run_id: run.id, source: s.key, url: s.url, http_status: status, fetched_at: now, payload: json,
      });
      if (error) errors.push({ source: s.key, step: 'raw', error: error.message });
    }

    const list = extractList(json);
    summary[s.key] = { rows: list.length };

    if (s.type === 'leaderboard') {
      const entries = [];
      ingestLeaderboard(s, list, players, entries);
      entriesBySource.push({ s, entries });
    } else if (s.type === 'clans') {
      ingestClans(list, clans);
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

  // 4. Close out the run
  const status = errors.length === 0 ? 'ok' : fetchedOk > 0 ? 'partial' : 'failed';
  await db.from('collection_runs')
    .update({ finished_at: new Date().toISOString(), status, summary, errors })
    .eq('id', run.id);

  return res.status(status === 'failed' ? 500 : 200).json({ runId: run.id, status, summary, errors });
}
