// Player Performance page data.
//   Six boards are RECORDS kept in the perf_records table (one row per player/clan = their personal best, no top-3 limit):
//     daily_kills, weekly_kills, gain_day, gain_week, gain_ranked, gain_clan
//     collectPerformance(items) + commitPerformance(acc) are called from api/collect.js with the same items the records step uses.
//   Two boards are READ from tables collect.js already fills:
//     lifetime_kdr  <- players (kills, deaths, kdr from saveLifetime)
//     month_kills   <- monthly_player_kills (from saveMonthlyKills, top 20 clans of each month)
//   performanceBackfill(after) rebuilds the six record boards from stored raw_snapshots (same cursor style as records.js backfill).
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { extractList } from './shared.js';

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent, MIN = 60e3;

const KDR_MIN_KILLS = 1000;       // lifetime KDR board only counts players with at least this many lifetime kills
const GAP = [50, 70];             // "1 hour" = two snapshots 50-70 minutes apart (same as records.js)
const LIMIT = 200;                // rows per board sent to the page

// shown on the page, in this order
export const BOARDS = {
  daily_kills:  { title: 'Highest daily kills',   unit: 'kills',    note: 'Best single day per player. Minimum 1,000 kills.' },
  weekly_kills: { title: 'Highest weekly kills',  unit: 'kills',    note: 'Best single week per player. Minimum 3,000 kills.' },
  gain_day:     { title: '1-hour gain: Daily',    unit: 'kills',    note: 'Most kills gained in about one hour on the daily board. Minimum +200.' },
  gain_week:    { title: '1-hour gain: Weekly',   unit: 'kills',    note: 'Most kills gained in about one hour on the weekly board. Minimum +200.' },
  gain_ranked:  { title: '1-hour gain: Ranked',   unit: 'trophies', note: 'Most trophies gained in about one hour. Minimum +200.' },
  gain_clan:    { title: '1-hour gain: Clans',    unit: 'kills',    note: 'Most clan kills gained in about one hour. Minimum +400.' },
  lifetime_kdr: { title: 'Best lifetime KDR',     unit: 'KDR',      note: `Lifetime kills divided by deaths. Minimum ${KDR_MIN_KILLS.toLocaleString('en-US')} lifetime kills. Only players who have appeared on a leaderboard are included.` },
  month_kills:  { title: 'Most kills in a month', unit: 'kills',    note: 'From the top 20 clans of each month only: every player in those clans is counted. Best month per player.' },
};

const KILL_RECORDS = { day: ['daily_kills', 1000], week: ['weekly_kills', 3000] };
const GAINS = {
  day:    { key: 'gain_day',    metric: 'kills',    min: 200 },
  week:   { key: 'gain_week',   metric: 'kills',    min: 200 },
  ranked: { key: 'gain_ranked', metric: 'trophies', min: 200 },
  clan:   { key: 'gain_clan',   metric: 'kills',    min: 400 },
};

async function get(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// items: [{ board: 'day'|'week'|'ranked'|'clan', payload, at (ms), prevPayload?, prevAt? }]  (same items the records step builds)
export function collectPerformance(items, acc = new Map()) {
  for (const { board, payload, at, prevPayload, prevAt } of items) {
    if (!payload) continue;
    const when = new Date(at).toISOString(), clan = board === 'clan', idk = clan ? 'clanId' : 'playerId', list = extractList(payload, idk) || [];
    const who = p => clan ? { id: p.clanId, name: p.name, tag: p.tag || null, color: p.color ?? null }
                          : { id: p.playerId, name: p.name, tag: p.clanTag || null, color: p.clanColor ?? null };
    const offer = (key, value, p, extra) => {
      const w = who(p); if (!w.id || !Number.isFinite(value)) return;
      const k = key + '|' + w.id, o = acc.get(k);
      if (!o || value > o.value) acc.set(k, { board: key, entity_id: String(w.id), name: w.name ?? null, tag: w.tag, color: w.color, value, achieved_at: when, extra: extra ?? null });
    };
    const kr = KILL_RECORDS[board];
    if (kr) for (const p of list) { const v = Number(p.kills); if (v >= kr[1]) offer(kr[0], v, p); }

    const g = GAINS[board], gap = prevAt == null ? NaN : (at - prevAt) / MIN;
    if (g && prevPayload && gap >= GAP[0] && gap <= GAP[1]) {
      const prev = new Map((extractList(prevPayload, idk) || []).map(p => [p[idk], Number(p[g.metric])]));
      let both = 0, down = 0;
      for (const p of list) { const b = prev.get(p[idk]); if (b !== undefined) { both++; if (Number(p[g.metric]) < b) down++; } }
      if (!(both && down / both > 0.5)) {                       // skip pairs that straddle a board reset
        for (const p of list) {
          const b = prev.get(p[idk]); if (b === undefined) continue;   // not on the earlier list: real gain unknown
          const v = Number(p[g.metric]), gain = v - b;
          if (gain >= g.min) offer(g.key, gain, p, { from: b, to: v });
        }
      }
    }
  }
  return acc;
}

// writes only rows that beat the stored personal best (SQL function perf_bump, see performance.sql)
export async function commitPerformance(acc) {
  const rows = [...acc.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${SB}/rest/v1/rpc/perf_bump`, { method: 'POST', headers: H, body: JSON.stringify({ rows: rows.slice(i, i + 500) }) });
    if (!r.ok) throw new Error(`perf_bump ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return { candidates: rows.length };
}

// Rebuild the six record boards from stored snapshots. Walks raw_snapshots by id for ~40 s, then returns where to continue (call again with after=next).
const SOURCE_BOARD = { 'leaderboard-day': 'day', 'leaderboard-week': 'week', 'leaderboard-ranked': 'ranked', clan: 'clan' };
export async function performanceBackfill(after = 0, budgetMs = 40000) {
  const t0 = Date.now(), acc = new Map(), buf = {};
  const prevFor = (board, at) => {
    let best = null;
    for (const p of buf[board] || []) { const g = (at - p.at) / MIN; if (g >= GAP[0] && g <= GAP[1] && (!best || Math.abs(g - 60) < Math.abs((at - best.at) / MIN - 60))) best = p; }
    return best;
  };
  const remember = (board, at, payload) => { (buf[board] ||= []).push({ at, payload }); buf[board] = buf[board].filter(p => p.at >= at - (GAP[1] + 5) * MIN); };
  if (after > 0) {   // continuing: reload the last ~75 minutes before the cursor so the first 1-hour gains are not lost
    const [r0] = await get(`raw_snapshots?select=fetched_at&id=eq.${after}`);
    if (r0) {
      const lo = new Date(Date.parse(r0.fetched_at) - (GAP[1] + 5) * MIN).toISOString();
      for (const r of await get(`raw_snapshots?select=id,source,fetched_at,payload&id=lte.${after}&fetched_at=gte.${enc(lo)}&order=id.asc&limit=300`))
        if (SOURCE_BOARD[r.source]) remember(SOURCE_BOARD[r.source], Date.parse(r.fetched_at), r.payload);
    }
  }
  let cursor = after, done = false, seen = 0;
  while (Date.now() - t0 < budgetMs) {
    const rows = await get(`raw_snapshots?select=id,source,fetched_at,payload&id=gt.${cursor}&order=id.asc&limit=20`);
    if (!rows.length) { done = true; break; }
    const items = [];
    for (const r of rows) {
      cursor = r.id; seen++;
      const board = SOURCE_BOARD[r.source]; if (!board) continue;
      const at = Date.parse(r.fetched_at), prev = prevFor(board, at);
      items.push({ board, payload: r.payload, at, prevPayload: prev?.payload, prevAt: prev?.at });
      remember(board, at, r.payload);
    }
    collectPerformance(items, acc);
  }
  await commitPerformance(acc);
  return { done, next: cursor, snapshotsScanned: seen, recordsFound: acc.size };
}

// ---------------- reading (the page) ----------------
const num = n => Number(n).toLocaleString('en-US');
async function recordBoard(id) {
  const rows = await get(`perf_records?select=entity_id,name,tag,color,value,achieved_at,extra&board=eq.${id}&order=value.desc&limit=${LIMIT}`);
  return rows.map(r => ({ id: r.entity_id, name: r.name, tag: r.tag, color: r.color, value: Number(r.value), achieved_at: r.achieved_at,
    detail: r.extra?.from !== undefined ? `${num(r.extra.from)} → ${num(r.extra.to)}` : '' }));
}
async function kdrBoard() {
  const rows = await get(`players?select=player_id,name,clan_tag,clan_color,kills,deaths,games,kdr&kdr=not.is.null&kills=gte.${KDR_MIN_KILLS}&order=kdr.desc&limit=${LIMIT}`);
  return rows.map(r => ({ id: r.player_id, name: r.name, tag: r.clan_tag, color: r.clan_color, value: Number(r.kdr), whenText: 'Lifetime',
    detail: `${num(r.kills)} kills / ${num(r.deaths)} deaths` }));
}
async function monthBoard() {
  const rows = await get(`monthly_player_kills?select=period,player_id,name,kills,clan_tag,clan_color,clan_name&order=kills.desc&limit=${LIMIT * 2}`);
  const seen = new Set(), out = [];
  for (const r of rows) {                                   // best month per player
    if (seen.has(r.player_id)) continue; seen.add(r.player_id);
    out.push({ id: r.player_id, name: r.name, tag: r.clan_tag, color: r.clan_color, value: Number(r.kills), whenText: String(r.period), detail: r.clan_name || '' });
  }
  return out.slice(0, LIMIT);
}

export async function performanceRead() {
  const boards = {}, errors = {};
  await Promise.all(Object.keys(BOARDS).map(async id => {
    try { boards[id] = id === 'lifetime_kdr' ? await kdrBoard() : id === 'month_kills' ? await monthBoard() : await recordBoard(id); }
    catch (e) { boards[id] = []; errors[id] = e.message; console.error(`performance ${id} failed:`, e.message); }
  }));
  return { generatedAt: new Date().toISOString(), meta: BOARDS, boards, errors };
}
