// Player Performance. Personal-best records (one row per player/clan per board) kept in the perf_records table.
//   performanceRead()          -> every board, top 200 each (the page)
//   performanceRecord()        -> compares the two newest stored snapshots of each board and bumps records (run hourly, after collect)
//   performanceBackfill(date)  -> same, but walks every stored snapshot of one UTC day (YYYY-MM-DD) to fill in history
// Never calls the Pangolin API: it only reads raw_snapshots. Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
import { extractList, normPlayer, normClan } from './shared.js';

const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent, MIN = 60e3, DAY = 864e5;

// shown on the page, in this order
export const BOARDS = {
  daily_kills:  { title: 'Highest daily kills',        unit: 'kills',    cutoff: 1000, note: 'Best single day. Minimum 1,000 kills.' },
  weekly_kills: { title: 'Highest weekly kills',       unit: 'kills',    cutoff: 3000, note: 'Best single week. Minimum 3,000 kills.' },
  gain_day:     { title: '1-hour gain: Daily',         unit: 'kills',    cutoff: 200,  note: 'Most kills gained in one hour on the daily board. Minimum +200.' },
  gain_week:    { title: '1-hour gain: Weekly',        unit: 'kills',    cutoff: 200,  note: 'Most kills gained in one hour on the weekly board. Minimum +200.' },
  gain_ranked:  { title: '1-hour gain: Ranked',        unit: 'trophies', cutoff: 200,  note: 'Most trophies gained in one hour. Minimum +200.' },
  gain_clan:    { title: '1-hour gain: Clans',         unit: 'kills',    cutoff: 400,  note: 'Most clan kills gained in one hour. Minimum +400.' },
  month_kills:  { title: 'Most kills in a month',      unit: 'kills',    cutoff: 0,    note: 'From the top 20 clans only: every player in those clans is counted.' },
  // lifetime_kdr: added once we know where lifetime kills/deaths live
};

const SRC = { day: 'leaderboard-day', week: 'leaderboard-week', ranked: 'leaderboard-ranked', clan: 'clan' };
const CFG = {
  day:    { kind: 'player', metric: 'kills',    value: 'daily_kills',  vmin: 1000, gain: 'gain_day' },
  week:   { kind: 'player', metric: 'kills',    value: 'weekly_kills', vmin: 3000, gain: 'gain_week' },
  ranked: { kind: 'player', metric: 'trophies', gain: 'gain_ranked' },
  clan:   { kind: 'clan',   metric: 'kills',    gain: 'gain_clan' },
};
const GAIN_MIN = { gain_day: 200, gain_week: 200, gain_ranked: 200, gain_clan: 400 };
const GAP = [40, 80];            // minutes between two snapshots that still count as "1 hour"
const ARCHIVE_SOURCE = 'clan';   // raw_snapshots source whose payload holds the clan member lists
const TOP_CLANS = 20;

async function get(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const toRows = (kind, payload) => {
  const list = extractList(payload, kind === 'clan' ? 'clanId' : 'playerId');
  return list ? list.map(kind === 'clan' ? normClan : normPlayer) : null;
};
const newest = async (source, n) => (await get(`raw_snapshots?select=fetched_at,payload&source=eq.${enc(source)}&order=fetched_at.desc&limit=${n}`))
  .map(r => ({ at: Date.parse(r.fetched_at), payload: r.payload }));
async function between(source, fromMs, toMs) {          // every stored snapshot in [from, to), oldest first
  const metas = await get(`raw_snapshots?select=id,fetched_at&source=eq.${enc(source)}&fetched_at=gte.${enc(new Date(fromMs).toISOString())}&fetched_at=lt.${enc(new Date(toMs).toISOString())}&order=fetched_at.asc&limit=1000`);
  const at = new Map(metas.map(m => [String(m.id), m.fetched_at])), out = [];
  for (let i = 0; i < metas.length; i += 6) {
    const ids = metas.slice(i, i + 6).map(m => m.id);
    for (const r of await get(`raw_snapshots?select=id,payload&id=in.(${ids.join(',')})`)) out.push({ at: Date.parse(at.get(String(r.id))), payload: r.payload });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---- turn two snapshots (a = older or null, b = newer) into record candidates ----
function candidates(board, a, b) {
  const c = CFG[board], id = c.kind === 'clan' ? 'clan_id' : 'player_id', rows = toRows(c.kind, b.payload), out = [];
  if (!rows) return out;
  const at = new Date(b.at).toISOString();
  const mk = (boardId, r, value, extra) => out.push({ board: boardId, entity_id: String(r[id]), name: r.name ?? null,
    tag: r.clan_tag ?? r.tag ?? null, color: r.clan_color ?? r.color ?? null, value, achieved_at: at, extra: extra ?? null });
  if (c.value) for (const r of rows) { const v = Number(r[c.metric]) || 0; if (v >= c.vmin) mk(c.value, r, v); }
  const dt = a ? (b.at - a.at) / MIN : 0, before = a && toRows(c.kind, a.payload);
  if (before && dt >= GAP[0] && dt <= GAP[1]) {
    const prev = new Map(before.map(r => [String(r[id]), Number(r[c.metric]) || 0]));
    let both = 0, down = 0;
    for (const r of rows) { const p = prev.get(String(r[id])); if (p !== undefined) { both++; if ((Number(r[c.metric]) || 0) < p) down++; } }
    if (!(both && down / both > 0.5)) {                   // skip pairs that straddle a board reset
      for (const r of rows) {
        const p = prev.get(String(r[id])); if (p === undefined) continue;   // just entered the list: real gain unknown
        const v = Number(r[c.metric]) || 0, g = v - p;
        if (g >= GAIN_MIN[c.gain]) mk(c.gain, r, g, { from: p, to: v });
      }
    }
  }
  return out;
}

// ---- monthly kills: every player of the top 20 clans in the clan snapshot that carries member lists ----
function monthly(snap) {
  const clans = [];
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (Array.isArray(o.members) && o.members.some(m => m && m.playerId)) clans.push(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(snap.payload);
  const uniq = new Map();
  for (const c of clans) { const k = c.clanId ?? c.tag; if (!uniq.has(k) || (c.kills || 0) > (uniq.get(k).kills || 0)) uniq.set(k, c); }
  const top = [...uniq.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0)).slice(0, TOP_CLANS);
  const d = new Date(snap.at), month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, at = d.toISOString(), out = [];
  for (const c of top) for (const m of c.members) if (m?.playerId && Number(m.kills) > 0)
    out.push({ board: 'month_kills', entity_id: String(m.playerId), name: m.name ?? null, tag: c.tag ?? null, color: c.color ?? null,
      value: Number(m.kills), achieved_at: at, extra: { clan: c.name ?? null, month } });
  return out;
}

async function bump(rows) {
  const best = new Map();                                  // one row per board+entity per call (a single upsert can't touch a row twice)
  for (const r of rows) { const k = `${r.board}|${r.entity_id}`, o = best.get(k); if (!o || r.value > o.value) best.set(k, r); }
  const list = [...best.values()];
  for (let i = 0; i < list.length; i += 500) {
    const r = await fetch(`${SB}/rest/v1/rpc/perf_bump`, { method: 'POST', headers: H, body: JSON.stringify({ rows: list.slice(i, i + 500) }) });
    if (!r.ok) throw new Error(await r.text());
  }
  return list.length;
}

export async function performanceRecord() {
  const rows = [], seen = {};
  for (const board of Object.keys(CFG)) {
    const s = await newest(SRC[board], 2);
    if (!s.length) { seen[board] = 0; continue; }
    const c = candidates(board, s[1] ?? null, s[0]);
    seen[board] = c.length; rows.push(...c);
  }
  const arch = ARCHIVE_SOURCE === SRC.clan ? (await newest(SRC.clan, 1))[0] : (await newest(ARCHIVE_SOURCE, 1))[0];
  const m = arch ? monthly(arch) : [];
  seen.month_kills = m.length; rows.push(...m);
  return { candidates: seen, written: await bump(rows) };
}

export async function performanceBackfill(dateStr) {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!mt) throw new Error('date=YYYY-MM-DD required');
  const start = Date.UTC(+mt[1], +mt[2] - 1, +mt[3]), end = start + DAY, rows = [], seen = {};
  for (const board of Object.keys(CFG)) {
    const snaps = await between(SRC[board], start, end);
    seen[board] = snaps.length;
    snaps.forEach((s, i) => rows.push(...candidates(board, snaps[i - 1] ?? null, s)));
    if (board === 'clan') snaps.forEach(s => rows.push(...monthly(s)));
  }
  return { date: dateStr, snapshots: seen, written: await bump(rows) };
}

export async function performanceRead() {
  const boards = {};
  await Promise.all(Object.keys(BOARDS).map(async id => {
    boards[id] = await get(`perf_records?select=entity_id,name,tag,color,value,achieved_at,extra&board=eq.${id}&order=value.desc&limit=200`);
  }));
  return { generatedAt: new Date().toISOString(), meta: BOARDS, boards };
}
