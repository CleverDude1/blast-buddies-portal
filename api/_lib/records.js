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

export const newAcc = () => ({ best: {}, l100: new Map() });

// items: [{ board: 'day'|'week'|'ranked'|'clan', payload, at (ms) }]  ->  acc = { best: {recordKey: Map(holderId -> row)}, l100: Map(playerId -> row) }
// Each holder only counts once per record (their own best score), so the top 3 are 3 different players / clans.
export function collect(items, acc = newAcc()) {
  const offer = (key, value, row) => {
    if (!Number.isFinite(value) || !row.holder_id) return;
    const m = (acc.best[key] ||= new Map()), prev = m.get(row.holder_id);
    if (!prev || value > prev.value) m.set(row.holder_id, { key, value, ...row });
  };
  for (const { board, payload, at } of items) {
    if (!payload) continue;
    const when = new Date(at).toISOString();
    if (board === 'clan') {
      for (const c of extractList(payload, 'clanId') || [])
        offer('clan_kills', Number(c.kills), { holder_id: c.clanId, holder_name: c.name, clan_tag: c.tag || null, clan_color: c.color ?? null, period: ymd(at), achieved_at: when });
      continue;
    }
    for (const p of extractList(payload, 'playerId') || []) {
      const who = { holder_id: p.playerId, holder_name: p.name, clan_tag: p.clanTag || null, clan_color: p.clanColor ?? null, achieved_at: when };
      if (board === 'day') offer('daily_kills', Number(p.kills), { ...who, period: ymd(at) });
      else if (board === 'week') offer('weekly_kills', Number(p.kills), { ...who, period: weekStart(at) });
      else if (board === 'ranked') offer('ranked_trophies', Number(p.trophies), { ...who, period: `Season ${payload.season ?? '?'}` });
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
  const keys = ['daily_kills', 'weekly_kills', 'ranked_trophies', 'clan_kills'];
  const [players, peak, ...tops] = await Promise.all([
    sb('level100_players?select=player_id,name,clan_tag,clan_color,total_xp,first_seen_at&order=total_xp.desc&limit=1000'),
    loadPeak().catch(() => null),   // null until the peak_online table exists
    ...keys.map(k => sb(`records?select=*&key=eq.${k}&order=value.desc&limit=${TOP}`)),
  ]);
  return { records: Object.fromEntries(keys.map((k, i) => [k, tops[i]])), level100: { count: players.length, players }, peak };
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
  const t0 = Date.now(), acc = newAcc();
  let cursor = after, done = false, seen = 0;
  while (Date.now() - t0 < budgetMs) {
    const rows = await sb(`raw_snapshots?select=id,url,fetched_at,payload&id=gt.${cursor}&order=id.asc&limit=20`);
    if (!rows.length) { done = true; break; }
    const items = [];
    for (const r of rows) { cursor = r.id; seen++; if (boardOf[r.url]) items.push({ board: boardOf[r.url], payload: r.payload, at: Date.parse(r.fetched_at) }); }
    collect(items, acc);
  }
  await commit(acc);
  return { done, next: cursor, snapshotsScanned: seen, level100Found: acc.l100.size };
}
