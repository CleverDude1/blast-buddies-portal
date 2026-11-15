// ONE function for every leaderboard: replaces api/leaderboard-week.js, leaderboard-ranked.js and clan.js (plus a day board).
// It behaves like those old proxies, just in a single file:
//
//   /api/board?board=day|week|ranked|clan      (aliases: daily, weekly, clans)
//     day, week : ?playerId=ID is passed on to the game's server only if YOU send it (nothing is added automatically)
//     ranked    : ?season=N is passed on (default 3, or RANKED_SEASON)
//     ?debug=1  adds an "upstream" section: the exact address called, the HTTP status, and the start of the answer
//     ?only=week (board=week) skips the daily part
//
// The old addresses keep working through the rewrites in vercel.json (see the bottom of this file):
//   /api/leaderboard-week -> /api/board?board=week      /api/leaderboard-ranked -> /api/board?board=ranked      /api/clan -> /api/board?board=clan
//
// Answer, same as the old proxies: { success, source: "blast-buddies", leaderboard, [season], retrievedAt, data }
// If the game's server answers with an error, this answers with the same HTTP status and { success: false, error, blastBuddiesStatus }.
// board=week also returns "daily" (as asked earlier: weekly and daily in one JSON):
//   live     = the game's daily board, fetched now
//   snapshot = the daily board the collector saved since 00:00 UTC, if it is under 70 minutes old
//   derived  = built from the weekly board: weekly kills now minus weekly kills at 00:00 UTC (close, not exact)
//
// STORED_FALLBACK (off): when true, a board the game's server will not give is answered from the newest saved snapshot instead of an error
// (marked source "stored", stale true). Left off so this file changes nothing about how errors look.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY (only for the daily part), RANKED_SEASON (optional, default 3)
import { rest, extractList } from './_lib/shared.js';

// ---- change addresses here if the game moves them ----
const EU = 'https://eu1-ping.blastbuddies.io', NA = 'https://na1-ping.blastbuddies.io';
const STORED_FALLBACK = false;
const BOARDS = {   // pass: the only query parameters that are forwarded to the game's server
  day:    { url: `${EU}/api/leaderboard/day`,    idKey: 'playerId', stored: 'leaderboard-day',    pass: ['playerId'] },
  week:   { url: `${EU}/api/leaderboard/week`,   idKey: 'playerId', stored: 'leaderboard-week',   pass: ['playerId'] },
  ranked: { url: `${NA}/api/leaderboard/ranked`, idKey: 'playerId', stored: 'leaderboard-ranked', pass: ['season'], defaults: { season: String(process.env.RANKED_SEASON || 3) } },
  clan:   { url: `${EU}/api/leaderboard/clans`,  idKey: 'clanId',   stored: 'clan',              pass: [] },
};
const ALIAS = { daily: 'day', weekly: 'week', clans: 'clan' };
const TIMEOUT_MS = 10000, MIN = 60e3, HOUR = 36e5, DAY = 864e5, FRESH_MIN = 70, DAY_ROWS = 100;
const enc = encodeURIComponent;
const num = v => Number(v) || 0;

// ---------- the game's server ----------
async function callUpstream(board, query) {
  const b = BOARDS[board], u = new URL(b.url);
  for (const k of b.pass) { const v = Array.isArray(query[k]) ? query[k][0] : query[k]; const val = v !== undefined && v !== '' ? v : b.defaults?.[k]; if (val !== undefined) u.searchParams.set(k, val); }
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const rows = data && typeof data === 'object' ? extractList(data, b.idKey) : null;
    return { ok: r.ok, status: r.status, data, rows: Array.isArray(rows) && rows.length ? rows : null, url: u.toString(), preview: text.slice(0, 300),
      error: r.ok ? null : `the game server returned HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 502, data: null, rows: null, url: u.toString(), preview: '', error: e.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000} seconds` : e.message };
  } finally { clearTimeout(timer); }
}

// ---------- what the collector saved ----------
const snap = async q => { try { return (await rest(`raw_snapshots?select=fetched_at,payload&${q}&limit=1`))[0] || null; } catch { return null; } };
const newestStored = async board => {
  const row = await snap(`source=eq.${enc(BOARDS[board].stored)}&order=fetched_at.desc`);
  const rows = row ? extractList(row.payload, BOARDS[board].idKey) : null;
  return Array.isArray(rows) && rows.length ? { at: row.fetched_at, payload: row.payload, rows } : null;
};

// weekly kills now - weekly kills at 00:00 UTC
async function derivedDaily(weekRows, startMs) {
  const startIso = new Date(startMs).toISOString();
  let base = await snap(`source=eq.leaderboard-week&fetched_at=lt.${enc(startIso)}&fetched_at=gte.${enc(new Date(startMs - 3 * HOUR).toISOString())}&order=fetched_at.desc`);
  if (!base) base = await snap(`source=eq.leaderboard-week&fetched_at=gte.${enc(startIso)}&order=fetched_at.asc`);
  const baseTop = base ? extractList(base.payload, 'playerId') || [] : [];
  if (!baseTop.length) return null;
  const baseMap = new Map(baseTop.map(r => [r.playerId, r]));
  let both = 0, down = 0;
  for (const r of weekRows) { const a = baseMap.get(r.playerId); if (a) { both++; if (num(r.kills) < num(a.kills)) down++; } }
  const reset = both > 0 && down / both > 0.5;                        // the weekly board reset since then: all of this week's kills are today's
  const floor = Math.min(...baseTop.map(r => num(r.kills)));
  const top = weekRows
    .map(r => {
      const a = baseMap.get(r.playerId), k = num(r.kills), d = num(r.deaths);
      if (reset) return { ...r, kills: k, deaths: d };
      if (a) return { ...r, kills: Math.max(0, k - num(a.kills)), deaths: Math.max(0, d - num(a.deaths)) };
      return { ...r, kills: Math.max(0, k - floor), deaths: 0 };
    })
    .filter(r => r.kills > 0 || r.deaths > 0)
    .sort((x, y) => y.kills - x.kills).slice(0, DAY_ROWS)
    .map((r, i) => ('rank' in r ? { ...r, rank: i + 1 } : r));
  return top.length ? { top, at: base.fetched_at } : null;
}

// the daily part of a weekly answer
async function buildDaily(query, weekLive, weekRows, nowMs) {
  const startMs = Math.floor(nowMs / DAY) * DAY, meta = { leaderboard: 'day', retrievedAt: new Date(nowMs).toISOString() };
  const live = await callUpstream('day', query);
  if (live.ok && live.rows) return { success: true, ...meta, source: 'live', approximate: false, data: { top: live.rows } };
  const fresh = await snap(`source=eq.leaderboard-day&fetched_at=gte.${enc(new Date(startMs).toISOString())}&order=fetched_at.desc`);
  const freshRows = fresh && nowMs - Date.parse(fresh.fetched_at) <= FRESH_MIN * MIN ? extractList(fresh.payload, 'playerId') : null;
  if (Array.isArray(freshRows) && freshRows.length) return { success: true, ...meta, source: 'snapshot', approximate: false, snapshotAt: fresh.fetched_at, data: { top: freshRows } };
  if (weekLive && weekRows) {
    const d = await derivedDaily(weekRows, startMs);
    if (d) return { success: true, ...meta, source: 'derived', approximate: true, baselineAt: d.at, data: { top: d.top } };
  }
  const old = STORED_FALLBACK ? await newestStored('day') : null;
  if (old) return { success: true, ...meta, source: 'stored', stale: true, approximate: false, snapshotAt: old.at, data: { top: old.rows } };
  return { success: false, ...meta, error: `no daily board available (${live.error})` };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const board = ALIAS[req.query.board] || req.query.board;
    if (!BOARDS[board]) return res.status(400).json({ success: false, error: 'board must be day, week, ranked or clan' });
    const nowMs = Date.now(), query = req.query, debug = query.debug === '1';

    const live = await callUpstream(board, query);
    const out = { success: live.ok, source: 'blast-buddies', leaderboard: board, retrievedAt: new Date(nowMs).toISOString() };
    if (board === 'ranked') out.season = Number(new URL(live.url).searchParams.get('season')) || BOARDS.ranked.defaults.season;
    let code = live.ok ? 200 : (live.status >= 400 ? live.status : 502);

    if (live.ok) {
      out.data = live.data;
    } else {
      out.blastBuddiesStatus = live.status;
      out.error = live.error;
      const old = STORED_FALLBACK ? await newestStored(board) : null;
      if (old) { Object.assign(out, { success: true, source: 'stored', stale: true, snapshotAt: old.at, upstreamError: live.error, data: old.payload.data ?? old.payload }); delete out.error; code = 200; }
    }

    if (board === 'week' && query.only !== 'week') out.daily = await buildDaily(query, live.ok, live.rows, nowMs);
    if (debug) out.upstream = { url: live.url, status: live.status, ok: live.ok, error: live.error, bodyStart: live.preview };

    res.setHeader('Cache-Control', out.source === 'stored' ? 'public, s-maxage=30, stale-while-revalidate=60' : 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(code).json(out);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/* ---------- vercel.json: keep the old addresses working (merge into your existing file if you have one) ----------
{
  "rewrites": [
    { "source": "/api/leaderboard-week",   "destination": "/api/board?board=week" },
    { "source": "/api/leaderboard-ranked", "destination": "/api/board?board=ranked" },
    { "source": "/api/leaderboard-day",    "destination": "/api/board?board=day" },
    { "source": "/api/clan",               "destination": "/api/board?board=clan" }
  ]
}
*/
