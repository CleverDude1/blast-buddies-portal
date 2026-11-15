// NEW API (separate from api/board.js, which stays the old API). Built on the game's updated calls:
//   https://na1-ping.blastbuddies.io/api/leaderboard/day?playerId=ID
//   https://na1-ping.blastbuddies.io/api/leaderboard/week?playerId=ID
//   https://na1-ping.blastbuddies.io/api/leaderboard/ranked?season=3&playerId=ID
//   https://na1-ping.blastbuddies.io/api/leaderboard/clans
// This file imports nothing from the rest of your project, so nothing else can break it.
//
//   /api/board-new                   (or ?board=all)  everything in ONE answer, shaped like the combined Pangolin snapshot:
//     { generatedAt, metadata: { source, stale, currentSeason, failed: [...] },
//       leaderboards: { daily: { top: [...] }, weekly: { top: [...] } },
//       ranked: { current: { season, top: [...] } },
//       clans: { top: [...], archives: [] } }
//     a board the game's server does not give is left out and named in metadata.failed; only if ALL four fail is the answer an error (502)
//   /api/board-new?board=day|week|ranked|clan   one board, same answer shape as the old proxies:
//     { success, source: "blast-buddies", leaderboard, [season], retrievedAt, data }  (an error keeps the game's HTTP status)
//
//   ?playerId=ID   overrides the player id (default: PLAYER_ID below, or the BB_PLAYER_ID environment variable in Vercel)
//   ?season=N      ranked season (default 3, or RANKED_SEASON)
//   ?debug=1       adds "upstream": the exact addresses called, their status, and the start of each answer
//
// Clan history (the monthly archives) is not available from the game's calls, so "archives" is empty and the Clan History tab stays hidden.
// Env vars (Vercel), all optional: BB_PLAYER_ID, RANKED_SEASON

// ---- change addresses / player id here ----
const NA = 'https://na1-ping.blastbuddies.io/api/leaderboard', EU = 'https://eu1-ping.blastbuddies.io/api/leaderboard';   // EU is only tried if NA fails
const PLAYER_ID = process.env.BB_PLAYER_ID || 'pEyooYhCf-xj';
const SEASON = String(process.env.RANKED_SEASON || 3);
const TIMEOUT_MS = 10000;
const BOARDS = {   // params: the query parameters sent to the game's server, in this order
  day:    { path: 'day',    idKey: 'playerId', params: ['playerId'] },
  week:   { path: 'week',   idKey: 'playerId', params: ['playerId'] },
  ranked: { path: 'ranked', idKey: 'playerId', params: ['season', 'playerId'] },
  clan:   { path: 'clans',  idKey: 'clanId',   params: [] },
};
const ALIAS = { daily: 'day', weekly: 'week', clans: 'clan', all: 'all' };

// finds the array of records (rows holding idKey) anywhere inside an answer
function findRows(d, idKey, depth = 0) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object' || depth > 3) return null;
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length && typeof v[0] === 'object' && idKey in v[0]) return v;
  for (const v of Object.values(d)) { const f = findRows(v, idKey, depth + 1); if (f) return f; }
  return null;
}

async function callOnce(name, root, query) {
  const b = BOARDS[name], u = new URL(`${root}/${b.path}`);
  const values = { playerId: first(query.playerId) || PLAYER_ID, season: first(query.season) || SEASON };
  for (const k of b.params) u.searchParams.set(k, values[k]);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const rows = data && typeof data === 'object' ? findRows(data, b.idKey) : null;
    const usable = r.ok && Array.isArray(rows) && rows.length > 0;
    return { ok: usable, status: r.status, data, rows: usable ? rows : null, url: u.toString(), preview: text.slice(0, 300), season: Number(values.season),
      error: usable ? null : (r.ok ? 'the game server answered, but without any rows' : `the game server returned HTTP ${r.status}`) };
  } catch (e) {
    return { ok: false, status: 502, data: null, rows: null, url: u.toString(), preview: '', season: Number(values.season),
      error: e.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000} seconds` : e.message };
  } finally { clearTimeout(timer); }
}
const first = v => (Array.isArray(v) ? v[0] : v);

// NA first, then EU only if NA gave nothing usable
async function call(name, query) {
  let firstFail = null;
  for (const root of [NA, EU]) { const r = await callOnce(name, root, query); if (r.ok) return r; firstFail = firstFail || r; }
  return firstFail;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const q = req.query, want = ALIAS[q.board] || q.board || 'all', debug = q.debug === '1';
    if (want !== 'all' && !BOARDS[want]) {
      return res.status(400).json({ success: false, error: `unknown board "${q.board}": use day, week, ranked, clan, or leave it out for everything` });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    const now = new Date().toISOString();

    // ---- one board, like the old proxies ----
    if (want !== 'all') {
      const r = await call(want, q);
      const out = { success: r.ok, source: 'blast-buddies', leaderboard: want, retrievedAt: now };
      if (want === 'ranked') out.season = r.season;
      if (r.ok) out.data = r.data; else { out.blastBuddiesStatus = r.status; out.error = r.error; }
      if (debug) out.upstream = { url: r.url, status: r.status, error: r.error, bodyStart: r.preview };
      return res.status(r.ok ? 200 : (r.status >= 400 ? r.status : 502)).json(out);
    }

    // ---- everything in one answer ----
    const names = Object.keys(BOARDS);
    const got = Object.fromEntries(await Promise.all(names.map(async n => [n, await call(n, q)])));
    const failed = names.filter(n => !got[n].ok);
    const season = got.ranked.season;
    const out = {
      generatedAt: now,
      metadata: { source: 'board-new', stale: false, currentSeason: season, failed },
      leaderboards: {}, ranked: {}, clans: { top: [], archives: [] },
    };
    if (got.day.ok) out.leaderboards.daily = { top: got.day.rows };
    if (got.week.ok) out.leaderboards.weekly = { top: got.week.rows };
    if (got.ranked.ok) out.ranked.current = { season, top: got.ranked.rows };
    if (got.clan.ok) out.clans.top = got.clan.rows.slice().sort((a, b) => (b.kills || 0) - (a.kills || 0));
    if (debug) out.upstream = Object.fromEntries(names.map(n => [n, { url: got[n].url, status: got[n].status, error: got[n].error, bodyStart: got[n].preview }]));
    if (failed.length === names.length) {
      return res.status(502).json({ success: false, error: 'the game server gave no usable data for any board', failed, errors: Object.fromEntries(names.map(n => [n, got[n].error])), ...(debug ? { upstream: out.upstream } : {}) });
    }
    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
