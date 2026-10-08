// Helpers shared by api/compare.js and api/hourly.js (files starting with "_" are not public endpoints).
import { SOURCES } from '../_sources/index.js';   // same source list the hourly collector uses

export const DAY = 864e5;
export const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const BASE = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';
const srcOf = board => (Array.isArray(SOURCES) ? SOURCES : []).find(s => s?.type === 'leaderboard' && s?.board === board);
export const RANKED_SEASON = Number(srcOf('ranked')?.season ?? process.env.RANKED_SEASON ?? 3);   // change when a new ranked season starts
export const URLS = {
  day:    srcOf('day')?.url    || `${BASE}/api/leaderboard-day`,
  week:   srcOf('week')?.url   || `${BASE}/api/leaderboard-week`,
  ranked: srcOf('ranked')?.url || `${BASE}/api/leaderboard-ranked?season=${RANKED_SEASON}`,
  clan:   (Array.isArray(SOURCES) ? SOURCES : []).find(s => s?.type === 'clans')?.url || `${BASE}/api/clan`,
};

// PostgREST helper. `all` pages through results (Supabase returns max 1000 rows per request).
export async function rest(path, { all = false, max = 1000 } = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  // New sb_secret_ keys go in the apikey header only; old JWT-style keys (eyJ...) also go in Authorization.
  const auth = key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, ...auth, 'Range-Unit': 'items', Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    rows.push(...page);
    if (!all || page.length < 1000 || rows.length >= max) break;
  }
  return rows;
}
export const inList = ids => `in.(${ids.join(',')})`;
export const since = days => encodeURIComponent(new Date(Date.now() - days * DAY).toISOString());

// ---------- live API (primary source) ----------
export async function fetchLive(url) {
  let last;
  for (let i = 0; i < 2; i++) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'cache-control': 'no-cache' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; } finally { clearTimeout(timer); }
  }
  throw last;
}
// finds the array of records anywhere inside an API response
export function extractList(d, idKey, depth = 0) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object' || depth > 3) return null;
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length && typeof v[0] === 'object' && idKey in v[0]) return v;
  for (const v of Object.values(d)) { const f = extractList(v, idKey, depth + 1); if (f) return f; }
  return null;
}
// API entry -> the row shape the Compare page uses (rank = position in the API's own order)
export const normPlayer = (e, i) => ({ player_id: e.playerId, rank: i == null ? null : i + 1, name: e.name, kills: e.kills, deaths: e.deaths, assists: e.assists,
  trophies: e.trophies, ranked_wins: e.rankedWins, ranked_losses: e.rankedLosses, total_xp: e.totalXp, top_weapon_id: e.topWeaponId,
  clan_tag: e.clanTag, clan_color: e.clanColor });
export const normClan = e => ({ clan_id: e.clanId, name: e.name, tag: e.tag, color: e.color, member_count: e.memberCount, member_cap: e.memberCap, open_join: e.openJoin, kills: e.kills });

