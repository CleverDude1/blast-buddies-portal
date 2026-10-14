// All-time records + "seen at level 100" tracking, stored in Supabase (tables: records, level100_players; see supabase.sql).
// Flow: take the leaderboard payloads (live or from raw_snapshots) -> collect() the best values -> commit() only writes what beats the stored record.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { URLS, extractList } from './shared.js';

// XP where level 100 begins = LEVEL_STARTS[99] in js/level.js (4,131,400). Update this if you change the level curve.
const LEVEL_100_XP = 4131400;
// Day the weekly board starts on (0 = Sunday, 1 = Monday ...). Only used for the "Week of ..." label.
const WEEK_START_DAY = 1;

const DAY = 864e5;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const weekStart = ms => {
  const d = new Date(ms), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return ymd(day - ((new Date(day).getUTCDay() - WEEK_START_DAY + 7) % 7) * DAY);
};

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const key = process.env.SUPABASE_SECRET_KEY, base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${base}/rest/v1/${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const TOP = 3;   // how many holders are kept per record
const KDR_MIN_KILLS = 1000;                  // best-KDR record only counts entries with at least this many kills
const MIN = 60e3, GAIN_MIN = 50, GAIN_MAX = 70;   // "gain in 1 hour" = two snapshots 50-70 minutes apart
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
const num = n => Number(n).toLocaleString('en-US');
const enc = encodeURIComponent;

export const newAcc = () => ({ best: {}, l100: new Map() });

// Biggest gain in about 1 hour: current board vs a snapshot 50-70 min earlier (players/clans that were on both lists).
function offerGains(offer, board, { payload, prevPayload, at, prevAt }) {
  if (!prevPayload || prevAt == null) return;
  const gap = (at - prevAt) / MIN; if (gap < GAIN_MIN || gap > GAIN_MAX) return;
  const clan = board === 'clan', idk = clan ? 'clanId' : 'playerId', metric = clan || board === 'day' || board === 'week' ? 'kills' : 'trophies';
  const prev = new Map((extractList(prevPayload, idk) || []).map(p => [p[idk], Number(p[metric])]));
  const key = 'hour_gain_' + { day: 'daily', week: 'weekly', ranked: 'ranked', clan: 'clan' }[board];
  const period = `${ymd(at)} ${hhmm(prevAt)}-${hhmm(at)} UTC`, when = new Date(at).toISOString();
  for (const p of extractList(payload, idk) || []) {
    const before = prev.get(p[idk]), gain = Number(p[metric]) - before;
    if (before === undefined || !(gain > 0)) continue;   // not on the earlier list, or went down (board reset)
    offer(key, gain, clan
      ? { holder_id: p.clanId, holder_name: p.name, clan_tag: p.tag || null, clan_color: p.color ?? null, period, achieved_at: when }
      : { holder_id: p.playerId, holder_name: p.name, clan_tag: p.clanTag || null, clan_color: p.clanColor ?? null, period, achieved_at: when });
  }
}

// items: [{ board: 'day'|'week'|'ranked'|'clan', payload, at (ms), prevPayload?, prevAt? }]  (prev* = snapshot ~1 hour earlier, for the 1-hour gain records)  ->  acc = { best: {recordKey: Map(holderId -> row)}, l100: Map(playerId -> row) }
// Each holder only counts once per record (their own best score), so the top 3 are 3 different players / clans.
export function collect(items, acc = newAcc()) {
  const offer = (key, value, row) => {
    if (!Number.isFinite(value) || !row.holder_id) return;
    const m = (acc.best[key] ||= new Map()), prev = m.get(row.holder_id);
    if (!prev || value > prev.value) m.set(row.holder_id, { key, value, ...row });
  };
  for (const item of items) {
    const { board, payload, at } = item;
    if (!payload) continue;
    const when = new Date(at).toISOString();
    offerGains(offer, board, item);
    if (board === 'clan') {
      for (const c of extractList(payload, 'clanId') || [])
        offer('clan_kills', Number(c.kills), { holder_id: c.clanId, holder_name: c.name, clan_tag: c.tag || null, clan_color: c.color ?? null, period: ymd(at), achieved_at: when });
      continue;
    }
    for (const p of extractList(payload, 'playerId') || []) {
      const who = { holder_id: p.playerId, holder_name: p.name, clan_tag: p.clanTag || null, clan_color: p.clanColor ?? null, achieved_at: when };
      if (board === 'day') offer('daily_kills', Number(p.kills), { ...who, period: ymd(at) });
      else if (board === 'week') offer('weekly_kills', Number(p.kills), { ...who, period: weekStart(at) });
      if ((board === 'day' || board === 'week') && Number(p.kills) >= KDR_MIN_KILLS) {
        const k = Number(p.kills), d = Number(p.deaths) || 0, kdr = Math.round((d > 0 ? k / d : k) * 100) / 100;
        offer('best_kdr', kdr, { ...who, period: `${board === 'day' ? 'Daily ' + ymd(at) : 'Weekly, week of ' + weekStart(at)} · ${num(k)} kills / ${num(d)} deaths` });
      }
      if (board === 'ranked') offer('ranked_trophies', Number(p.trophies), { ...who, period: `Season ${payload.season ?? '?'}` });
      const xp = Number(p.totalXp);
      if (xp >= LEVEL_100_XP) {
        const prev = acc.l100.get(p.playerId);
        if (!prev || xp > prev.total_xp) acc.l100.set(p.playerId, { player_id: p.playerId, name: p.name, clan_tag: p.clanTag || null, clan_color: p.clanColor ?? null, total_xp: xp });
      }
    }
  }
  return acc;
}

export async function commit(acc, now = Date.now()) {
  const keys = Object.keys(acc.best);
  if (keys.length) {
    const have = await sb('records?select=key,holder_id,value'), cur = {};
    for (const r of have) (cur[r.key] ||= new Map()).set(r.holder_id, Number(r.value));
    const rows = [], drop = [];
    for (const key of keys) {
      const stored = cur[key] || new Map(), cand = [...acc.best[key].values()], merged = new Map(stored);
      for (const c of cand) if (!(merged.get(c.holder_id) >= c.value)) merged.set(c.holder_id, c.value);
      const keep = new Set([...merged].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(x => x[0]));
      for (const c of cand) if (keep.has(c.holder_id) && !(stored.get(c.holder_id) >= c.value)) rows.push(c);   // new or improved
      for (const id of stored.keys()) if (!keep.has(id)) drop.push([key, id]);                                    // pushed out of the top 3
    }
    if (rows.length) await sb('records?on_conflict=key,holder_id', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    for (const [key, id] of drop) await sb(`records?key=eq.${encodeURIComponent(key)}&holder_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  if (acc.l100.size) {
    const ts = new Date(now).toISOString();
    await sb('level100_players?on_conflict=player_id', { method: 'POST', body: [...acc.l100.values()].map(r => ({ ...r, last_seen_at: ts })), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}

// convenience for collect.js:  await recordPayloads({ day: payloadDay, week: payloadWeek, ranked: payloadRanked, clan: payloadClan })
export const recordPayloads = (byBoard, at = Date.now()) =>
  commit(collect(Object.entries(byBoard).filter(([, p]) => p).map(([board, payload]) => ({ board, payload, at }))), at);

export async function loadStats() {
  const keys = ['daily_kills', 'weekly_kills', 'ranked_trophies', 'clan_kills', 'best_kdr', 'hour_gain_daily', 'hour_gain_weekly', 'hour_gain_ranked', 'hour_gain_clan'];
  const [players, peak, ...tops] = await Promise.all([
    sb('level100_players?select=player_id,name,clan_tag,clan_color,total_xp,first_seen_at&order=total_xp.desc&limit=1000'),
    loadPeak().catch(() => null),   // null until the peak_online table exists
    ...keys.map(k => sb(`records?select=*&key=eq.${k}&order=value.desc&limit=${TOP}`)),
  ]);
  return { records: Object.fromEntries(keys.map((k, i) => [k, tops[i]])), level100: { count: players.length, players }, peak };
}

// the stored snapshot closest to 1 hour before `now` (50-70 min back), or null
export async function hourAgo(url, now = Date.now()) {
  const lo = new Date(now - GAIN_MAX * MIN).toISOString(), hi = new Date(now - GAIN_MIN * MIN).toISOString();
  const metas = await sb(`raw_snapshots?select=id,fetched_at&url=eq.${enc(url)}&fetched_at=gte.${enc(lo)}&fetched_at=lte.${enc(hi)}&order=fetched_at.desc&limit=30`);
  if (!metas.length) return null;
  const best = metas.reduce((a, b) => Math.abs(now - Date.parse(b.fetched_at) - 60 * MIN) < Math.abs(now - Date.parse(a.fetched_at) - 60 * MIN) ? b : a);
  const [row] = await sb(`raw_snapshots?select=payload&id=eq.${best.id}`);
  return row ? { at: Date.parse(best.fetched_at), payload: row.payload } : null;
}

// ---------- highest players online (all time) ----------
// payload = the /api/rooms response. Counts players per region; ok = how many regions answered.
export function roomTotals(payload) {
  const t = { na: 0, eu: 0, as: 0, total: 0, rooms: 0, ok: 0 };
  for (const k of ['na', 'eu', 'as']) {
    const r = payload?.regions?.[k];
    if (!r?.success || !Array.isArray(r.data)) continue;
    t.ok++; t.rooms += r.data.length;
    t[k] = r.data.reduce((s, x) => s + (Number(x.players) || 0), 0);
    t.total += t[k];
  }
  return t;
}
export async function loadPeak() {
  const [row] = await sb('peak_online?select=*&id=eq.all');
  return row || null;
}
// replaces the stored peak only when the current total beats it
export async function updatePeak(t, now = Date.now()) {
  if (!t || !t.ok || !(t.total > 0)) return null;
  const cur = await loadPeak();
  if (cur && Number(cur.total) >= t.total) return cur;
  const row = { id: 'all', total: t.total, na_players: t.na, eu_players: t.eu, as_players: t.as, rooms: t.rooms, achieved_at: new Date(now).toISOString() };
  await sb('peak_online?on_conflict=id', { method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=minimal' });
  return row;
}

// how many of the top N players use each weapon: { total, list: [{ id, count }] sorted most used first }
export function weaponCounts(payload, top = 50) {
  const list = (extractList(payload, 'playerId') || []).slice(0, top), m = new Map();
  for (const p of list) if (p.topWeaponId != null) m.set(p.topWeaponId, (m.get(p.topWeaponId) || 0) + 1);
  return { total: list.length, list: [...m].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id - b.id) };
}

// Rebuild records + level-100 players from the snapshots you already stored. Walks raw_snapshots by id for ~40 s, then returns where to continue.
export async function backfill(after = 0, budgetMs = 40000) {
  const boardOf = Object.fromEntries(Object.entries(URLS).map(([b, u]) => [u, b]));
  const t0 = Date.now(), acc = newAcc(), buf = {};   // buf: board -> recent snapshots, used to find the one ~1 hour earlier
  const prevFor = (board, at) => {
    let best = null;
    for (const p of buf[board] || []) { const g = (at - p.at) / MIN; if (g >= GAIN_MIN && g <= GAIN_MAX && (!best || Math.abs(g - 60) < Math.abs((at - best.at) / MIN - 60))) best = p; }
    return best;
  };
  const remember = (board, at, payload) => { (buf[board] ||= []).push({ at, payload }); buf[board] = buf[board].filter(p => p.at >= at - (GAIN_MAX + 5) * MIN); };
  if (after > 0) {   // continuing: reload the last ~75 minutes before the cursor so the first 1-hour gains are not lost
    const [r0] = await sb(`raw_snapshots?select=fetched_at&id=eq.${after}`);
    if (r0) {
      const lo = new Date(Date.parse(r0.fetched_at) - (GAIN_MAX + 5) * MIN).toISOString();
      for (const r of await sb(`raw_snapshots?select=id,url,fetched_at,payload&id=lte.${after}&fetched_at=gte.${enc(lo)}&order=id.asc&limit=300`))
        if (boardOf[r.url]) remember(boardOf[r.url], Date.parse(r.fetched_at), r.payload);
    }
  }
  let cursor = after, done = false, seen = 0;
  while (Date.now() - t0 < budgetMs) {
    const rows = await sb(`raw_snapshots?select=id,url,fetched_at,payload&id=gt.${cursor}&order=id.asc&limit=20`);
    if (!rows.length) { done = true; break; }
    const items = [];
    for (const r of rows) {
      cursor = r.id; seen++;
      const board = boardOf[r.url]; if (!board) continue;
      const at = Date.parse(r.fetched_at), prev = prevFor(board, at);
      items.push({ board, payload: r.payload, at, prevPayload: prev?.payload, prevAt: prev?.at });
      remember(board, at, r.payload);
    }
    collect(items, acc);
  }
  await commit(acc);
  return { done, next: cursor, snapshotsScanned: seen, level100Found: acc.l100.size };
}
