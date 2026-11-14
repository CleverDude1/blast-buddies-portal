// /api/leaderboard-week  ->  the WEEKLY leaderboard plus the DAILY leaderboard, in one JSON response.
//
//   {
//     success, source, leaderboard: "week", retrievedAt,
//     data:  <the game's weekly answer, unchanged>            (same as the old weekly endpoint, so nothing that reads it breaks)
//     daily: { success, leaderboard: "day", source, approximate, baselineAt, retrievedAt, data: { top: [...] } }
//   }
//
// There is no daily API, so the daily board is worked out here:
//   source "snapshot": the daily board the hourly collector stored since 00:00 UTC, if it is less than 70 minutes old (exact when the
//                      new API delivered it, approximate when the collector had to build it)
//   source "derived" : otherwise built live: each player's weekly kills NOW (just fetched) minus their weekly kills at 00:00 UTC
//                      (the newest stored weekly snapshot from just before midnight). Only players on the weekly list can appear,
//                      so it is close but not exact -> "approximate": true
// If the game's weekly server does not answer, "success" is false for the weekly part and the daily part falls back to the stored snapshot.
//
// Options:  ?playerId=ID   passed on to the game's weekly server, like before
//           ?only=week     skip the daily part (cheaper);   ?only=day   leave the weekly data out of the answer
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY (only needed for the daily part)
import { rest, extractList } from './_lib/shared.js';

const UPSTREAM = 'https://eu1-ping.blastbuddies.io/api/leaderboard/week';
const MIN = 60e3, HOUR = 36e5, DAY = 864e5, FRESH_MIN = 70, DAY_ROWS = 100;
const enc = encodeURIComponent;
const num = v => Number(v) || 0;

async function getWeekly(playerId) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(UPSTREAM + (playerId ? `?playerId=${enc(playerId)}` : ''), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 502, error: e.name === 'AbortError' ? 'the game server did not answer within 10 seconds' : e.message };
  } finally { clearTimeout(timer); }
}

const snap = async query => (await rest(`raw_snapshots?select=fetched_at,payload&${query}&limit=1`))[0] || null;

// the daily board the collector stored today, if it is recent enough
async function storedDaily(startMs, nowMs) {
  const row = await snap(`source=eq.leaderboard-day&fetched_at=gte.${enc(new Date(startMs).toISOString())}&order=fetched_at.desc`);
  if (!row || nowMs - Date.parse(row.fetched_at) > FRESH_MIN * MIN) return null;
  const top = extractList(row.payload, 'playerId');
  return Array.isArray(top) && top.length ? { top, at: row.fetched_at } : null;
}

// weekly kills now - weekly kills at 00:00 UTC
async function derivedDaily(weekTop, startMs, nowMs) {
  const startIso = new Date(startMs).toISOString();
  let base = await snap(`source=eq.leaderboard-week&fetched_at=lt.${enc(startIso)}&fetched_at=gte.${enc(new Date(startMs - 3 * HOUR).toISOString())}&order=fetched_at.desc`);
  if (!base) base = await snap(`source=eq.leaderboard-week&fetched_at=gte.${enc(startIso)}&order=fetched_at.asc`);   // none near midnight: first one today
  if (!base) return null;
  const baseTop = extractList(base.payload, 'playerId') || [];
  if (!baseTop.length) return null;
  const baseMap = new Map(baseTop.map(r => [r.playerId, r]));
  let both = 0, down = 0;
  for (const r of weekTop) { const a = baseMap.get(r.playerId); if (a) { both++; if (num(r.kills) < num(a.kills)) down++; } }
  const reset = both > 0 && down / both > 0.5;                        // the weekly board reset since then: all of this week's kills are today's
  const floor = Math.min(...baseTop.map(r => num(r.kills)));
  const top = weekTop
    .map(r => {
      const a = baseMap.get(r.playerId), k = num(r.kills), d = num(r.deaths);
      if (reset) return { ...r, kills: k, deaths: d };
      if (a) return { ...r, kills: Math.max(0, k - num(a.kills)), deaths: Math.max(0, d - num(a.deaths)) };
      return { ...r, kills: Math.max(0, k - floor), deaths: 0 };       // joined the weekly list during the day: at least this many
    })
    .filter(r => r.kills > 0 || r.deaths > 0)
    .sort((x, y) => y.kills - x.kills)
    .slice(0, DAY_ROWS)
    .map((r, i) => ('rank' in r ? { ...r, rank: i + 1 } : r));
  return top.length ? { top, at: base.fetched_at } : null;
}

async function buildDaily(weekly, startMs, nowMs) {
  const base = { leaderboard: 'day', retrievedAt: new Date(nowMs).toISOString() };
  try {
    const weekTop = weekly.ok ? extractList(weekly.data, 'playerId') : null;
    // 1) a stored daily board from today that is still fresh
    const stored = await storedDaily(startMs, nowMs);
    if (stored) return { success: true, ...base, source: 'snapshot', approximate: false, baselineAt: null, snapshotAt: stored.at, data: { top: stored.top } };
    // 2) built live from the weekly board
    if (Array.isArray(weekTop) && weekTop.length) {
      const d = await derivedDaily(weekTop, startMs, nowMs);
      if (d) return { success: true, ...base, source: 'derived', approximate: true, baselineAt: d.at, data: { top: d.top } };
      return { success: false, ...base, error: 'no weekly snapshot from around 00:00 UTC is stored yet, so the daily board cannot be built' };
    }
    return { success: false, ...base, error: 'the weekly board was not available, so the daily board could not be built' };
  } catch (e) {
    return { success: false, ...base, error: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const only = req.query.only === 'week' || req.query.only === 'day' ? req.query.only : 'both';
    const nowMs = Date.now(), startMs = Math.floor(nowMs / DAY) * DAY;

    const weekly = await getWeekly(req.query.playerId || '');
    const daily = only === 'week' ? null : await buildDaily(weekly, startMs, nowMs);

    const out = { success: weekly.ok || !!daily?.success, source: 'blast-buddies', leaderboard: 'week', retrievedAt: new Date(nowMs).toISOString() };
    if (only !== 'day') {
      if (weekly.ok) out.data = weekly.data;
      else { out.weeklyError = weekly.error || `the game server returned HTTP ${weekly.status}`; out.data = null; }
    }
    if (daily) out.daily = daily;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');   // protects the game server from many visitors
    return res.status(out.success ? 200 : 502).json(out);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
