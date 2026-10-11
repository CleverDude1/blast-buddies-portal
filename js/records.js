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

// items: [{ board: 'day'|'week'|'ranked'|'clan', payload, at (ms) }]  ->  { best: {recordKey: row}, l100: Map(playerId -> row) }
export function collect(items) {
  const best = {}, l100 = new Map();
  const offer = (key, value, row) => { if (Number.isFinite(value) && (!best[key] || value > best[key].value)) best[key] = { key, value, ...row }; };
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
        const prev = l100.get(p.playerId);
        if (!prev || xp > prev.total_xp) l100.set(p.playerId, { player_id: p.playerId, name: p.name, clan_tag: p.clanTag || null, clan_color: p.clanColor ?? null, total_xp: xp });
      }
    }
  }
  return { best, l100 };
}

export async function commit({ best, l100 }, now = Date.now()) {
  const keys = Object.keys(best);
  if (keys.length) {
    const cur = new Map((await sb('records?select=key,value')).map(r => [r.key, Number(r.value)]));
    const rows = keys.filter(k => !(cur.get(k) >= best[k].value)).map(k => best[k]);   // only what beats the stored record
    if (rows.length) await sb('records?on_conflict=key', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  if (l100.size) {
    const ts = new Date(now).toISOString();
    await sb('level100_players?on_conflict=player_id', { method: 'POST', body: [...l100.values()].map(r => ({ ...r, last_seen_at: ts })), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}

// convenience for collect.js:  await recordPayloads({ day: payloadDay, week: payloadWeek, ranked: payloadRanked, clan: payloadClan })
export const recordPayloads = (byBoard, at = Date.now()) =>
  commit(collect(Object.entries(byBoard).filter(([, p]) => p).map(([board, payload]) => ({ board, payload, at }))), at);

export async function loadStats() {
  const [records, players] = await Promise.all([
    sb('records?select=*'),
    sb('level100_players?select=player_id,name,clan_tag,clan_color,total_xp,first_seen_at&order=total_xp.desc&limit=1000'),
  ]);
  return { records: Object.fromEntries(records.map(r => [r.key, r])), level100: { count: players.length, players } };
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
  const t0 = Date.now(), acc = { best: {}, l100: new Map() };
  let cursor = after, done = false, seen = 0;
  while (Date.now() - t0 < budgetMs) {
    const rows = await sb(`raw_snapshots?select=id,url,fetched_at,payload&id=gt.${cursor}&order=id.asc&limit=20`);
    if (!rows.length) { done = true; break; }
    const items = [];
    for (const r of rows) { cursor = r.id; seen++; if (boardOf[r.url]) items.push({ board: boardOf[r.url], payload: r.payload, at: Date.parse(r.fetched_at) }); }
    const part = collect(items);
    for (const [k, v] of Object.entries(part.best)) if (!acc.best[k] || v.value > acc.best[k].value) acc.best[k] = v;
    for (const [id, v] of part.l100) if (!acc.l100.has(id) || v.total_xp > acc.l100.get(id).total_xp) acc.l100.set(id, v);
  }
  await commit(acc);
  return { done, next: cursor, snapshotsScanned: seen, records: Object.keys(acc.best).length, level100Found: acc.l100.size };
}
