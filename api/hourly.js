// "What changed". Works out gains and position changes from the stored JSON snapshots (raw_snapshots).
//   /api/hourly?mode=prev&board=day|week|ranked|clan&span=hour|day|week   -> per-entry gains for the leaderboard pages (+2k labels, arrows)
//   /api/hourly?mode=summary&span=hour|day|week[&date=YYYY-MM-DD]         -> totals, every entry's gain/position change, strongest clans, graph lines
//   /api/hourly?mode=clan-updates&kind=all|left|joined|renamed|access|color&q=&offset=   -> Clan Updates feed
//   /api/hourly?mode=vote                                             -> Community Vote (GET = status/results, POST = submit ballot)
//
// DATA SOURCE: the old per-board APIs are gone. The collector (api/collect.js) fetches the combined Pangolin API once an hour and
// stores one snapshot per board in raw_snapshots (source = leaderboard-day | leaderboard-week | leaderboard-ranked | clan).
// This file NEVER calls the Pangolin API itself (it only allows 1 request per 5 minutes per IP), so "now" means the NEWEST STORED
// snapshot and every comparison is made between stored snapshots.
//
// span=hour : the stored snapshot closest to 1 hour before the newest one  ->  the newest one.
// span=day  : EVERY stored snapshot from 00:00 UTC today ->  newest.   With &date=...: every snapshot of that past day, 00:00 to 00:00 UTC.
// span=week : the 7 UTC days ending today (or ending on &date=...), sampled to roughly one snapshot per 3 hours (always keeping the
//             first and last snapshot of each day).
//             (span=day and span=week need at least 2 stored snapshots in the period, so right after 00:00 UTC they may be empty for ~1 hour.)
//
// Board sizes follow the API: daily 100, weekly 100, ranked 500, clans 100. Gains are added up snapshot by snapshot for everyone who
// shows up at any point, so nobody is dropped just because they were not on the list at the start.
//   - seen in two snapshots in a row: the real difference is counted
//   - enters the list: we only know they were below the previous cut-off, so at least (their value - the lowest value on the previous list)
//     is counted -> marked partial (~)
//   - leaves the list: nothing is counted after that -> marked partial (~)
//   - a daily/weekly board that reset between two snapshots: values since the reset are counted
// The DAILY board is the exception for span=day: it starts at 0 at 00:00 UTC, so a player's value IS what they gained that day.
// For span=week the DAILY board is summed per UTC day: each day's last seen value is added up (partial = missing from the list on some days).
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, VOTE_SALT
import { rest, extractList, normPlayer, normClan } from './_lib/shared.js';
import { clanUpdates } from './_lib/clan-updates.js';
import { playerUpdates } from './_lib/player-updates.js';
import voteHandler from './_lib/vote.js';

// a week summary reads a lot of snapshots; give Vercel more time (remove if your plan does not allow it)
export const config = { maxDuration: 60 };

const BOARDS = {
  day:    { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true,  keys: ['kills', 'deaths'] },
  week:   { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true,  keys: ['kills', 'deaths'] },
  ranked: { kind: 'player', metric: 'trophies', unit: 'trophies', resets: false, keys: ['trophies', 'wins', 'losses'] },
  clan:   { kind: 'clan',   metric: 'kills',    unit: 'kills',    resets: false, keys: ['kills', 'members'] },
};
// board -> raw_snapshots.source written by api/collect.js (same keys the old collector used, so history carries over)
const SOURCE = { day: 'leaderboard-day', week: 'leaderboard-week', ranked: 'leaderboard-ranked', clan: 'clan' };
const MIN = 60e3, DAY = 864e5;
const WEEK_DAYS = 7, WEEK_STEP = 3 * 60 * MIN, CHUNK = 12;   // WEEK_STEP: lower = more accurate but slower
const MAX_ALL = 700;                                          // rows returned per board in summary (ranked has 500 players, plus anyone who left)
const FIELD = { wins: 'ranked_wins', losses: 'ranked_losses', members: 'member_count' };
const fv = (r, x) => Number(r[FIELD[x] ?? x] ?? 0) || 0;
const idKey = kind => (kind === 'clan' ? 'clan_id' : 'player_id');

// raw payload -> ranked rows. Players keep the API's order; clans are ranked by kills (same as the Rankings page).
function toRows(kind, payload) {
  const list = extractList(payload, kind === 'clan' ? 'clanId' : 'playerId');
  if (!list) return null;
  if (kind === 'clan') return list.map(normClan).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)).map((r, i) => ({ ...r, rank: i + 1 }));
  return list.map(normPlayer);
}

// ---------- reading stored snapshots ----------
const enc = encodeURIComponent;
const src = board => `source=eq.${enc(SOURCE[board])}`;
async function latestSnapshot(board) {                   // the newest stored snapshot = "now"
  const [row] = await rest(`raw_snapshots?select=fetched_at,payload&${src(board)}&order=fetched_at.desc&limit=1`);
  return row ? { at: Date.parse(row.fetched_at), payload: row.payload } : null;
}
async function latestRows(board) {
  try {
    const s = await latestSnapshot(board);
    return (s && toRows(BOARDS[board].kind, s.payload)) || [];
  } catch (e) { console.error(`latest ${board} failed:`, e.message); return []; }
}
async function hourSnapshot(board, refAt) {              // closest to 1 hour before refAt (looks 30 min to 2.5 h before it)
  const lo = new Date(refAt - 150 * MIN).toISOString(), hi = new Date(refAt - 30 * MIN).toISOString();
  const metas = await rest(`raw_snapshots?select=id,fetched_at&${src(board)}&fetched_at=gte.${enc(lo)}&fetched_at=lte.${enc(hi)}&order=fetched_at.desc&limit=20`);
  if (!metas.length) return null;
  const want = refAt - 60 * MIN;
  const best = metas.reduce((a, b) => Math.abs(Date.parse(b.fetched_at) - want) < Math.abs(Date.parse(a.fetched_at) - want) ? b : a);
  const [row] = await rest(`raw_snapshots?select=payload&id=eq.${best.id}`);
  return row ? { at: Date.parse(best.fetched_at), payload: row.payload } : null;
}
async function snapshotsBetween(board, fromMs, toMs) {   // every stored snapshot in [from, to), oldest first
  const rows = await rest(`raw_snapshots?select=fetched_at,payload&${src(board)}&fetched_at=gte.${enc(new Date(fromMs).toISOString())}&fetched_at=lt.${enc(new Date(toMs).toISOString())}&order=fetched_at.asc`, { all: true, max: 200 });
  return rows.map(r => ({ at: Date.parse(r.fetched_at), payload: r.payload }));
}
// a week is hundreds of snapshots: read only ids + timestamps first, keep ~1 per WEEK_STEP (plus the first and last of every day,
// which bracket the 00:00 reset), then fetch just those payloads
async function sampledSnapshots(board, fromMs, toMs) {
  const spans = [];
  for (let t = fromMs; t < toMs; t += DAY) spans.push([t, Math.min(t + DAY, toMs)]);
  const lists = await Promise.all(spans.map(([a, b]) => rest(
    `raw_snapshots?select=id,fetched_at&${src(board)}&fetched_at=gte.${enc(new Date(a).toISOString())}&fetched_at=lt.${enc(new Date(b).toISOString())}&order=fetched_at.asc&limit=1000`)));
  const keep = new Map();                                   // id -> fetched_at
  for (const metas of lists) {
    if (!metas.length) continue;
    keep.set(metas[0].id, metas[0].fetched_at);
    keep.set(metas[metas.length - 1].id, metas[metas.length - 1].fetched_at);
    let last = -Infinity;
    for (const m of metas) { const at = Date.parse(m.fetched_at); if (at - last >= WEEK_STEP) { keep.set(m.id, m.fetched_at); last = at; } }
  }
  const ids = [...keep.keys()], chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const got = await Promise.all(chunks.map(c => rest(`raw_snapshots?select=id,payload&id=in.(${c.join(',')})`)));
  return got.flat().map(r => ({ at: Date.parse(keep.get(r.id)), payload: r.payload })).sort((a, b) => a.at - b.at);
}
const dayStartOf = dateStr => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// the points in time to walk through: [{ at, rows }, ...] oldest first (null if there is not enough data)
async function pointsFor(board, span, dateStr) {
  const B = BOARDS[board], now = Date.now();
  const point = (at, payload) => { const rows = toRows(B.kind, payload); return rows && rows.length ? { at, rows } : null; };
  if (span === 'hour') {
    const latest = await latestSnapshot(board), p1 = latest && point(latest.at, latest.payload);
    if (!p1) return null;
    const snap = await hourSnapshot(board, latest.at), p0 = snap && point(snap.at, snap.payload);
    return p0 ? [p0, p1] : null;
  }
  if (span === 'week') {
    const endDay = dayStartOf(dateStr), start = endDay - (WEEK_DAYS - 1) * DAY, end = endDay + DAY, isToday = now >= endDay && now < end;
    const snaps = await sampledSnapshots(board, start, isToday ? now + 1 : end);
    const pts = snaps.map(s => point(s.at, s.payload)).filter(Boolean);
    return pts.length >= 2 ? pts : null;
  }
  const start = dayStartOf(dateStr), end = start + DAY, isToday = now >= start && now < end;
  const snaps = await snapshotsBetween(board, start, isToday ? now + 1 : end);
  const pts = snaps.map(s => point(s.at, s.payload)).filter(Boolean);
  return pts.length >= 2 ? pts : null;
}
const elapsedMin = pts => Math.round((pts[pts.length - 1].at - pts[0].at) / MIN);

// ---------- the engine: add up the changes snapshot by snapshot ----------
function chain(board, span, pts) {
  const B = BOARDS[board], k = idKey(B.kind), M = B.metric, n = pts.length, last = n - 1;
  const exact = board === 'day' && span === 'day';          // daily board: value = what was gained today
  const perDay = board === 'day' && span === 'week';        // daily board over a week: add up each UTC day's last value
  const dayOf = pts.map(p => Math.floor(p.at / DAY)), totalDays = new Set(dayOf).size;
  const zero = () => Object.fromEntries(B.keys.map(x => [x, 0]));
  const maps = pts.map(p => new Map(p.rows.map(r => [r[k], r])));
  const cutoff = pts.map(p => Math.min(...p.rows.map(r => fv(r, M))));        // everyone not on the list is below this
  const reset = pts.map((_, i) => {                                             // did the board reset between point i-1 and i?
    if (!B.resets || i === 0) return false;
    let both = 0, down = 0;
    for (const [id, r] of maps[i]) { const a = maps[i - 1].get(id); if (a) { both++; if (fv(r, M) < fv(a, M)) down++; } }
    return both > 0 && down / both > 0.5;
  });
  const E = new Map();
  for (let i = 0; i < n; i++) for (const [id, r] of maps[i]) {
    let e = E.get(id);
    if (!e) E.set(id, e = { id, firstIdx: i, est: false, gain: zero(), cum: [], base: zero(), cur: zero(), curDay: null, days: new Set() });
    e.name = r.name ?? e.name; e.tag = r.clan_tag ?? r.tag ?? e.tag ?? ''; e.color = r.clan_color ?? r.color ?? e.color ?? null;
    e.lastIdx = i; e.lastRow = r;
    if (exact) {
      for (const x of B.keys) e.gain[x] = fv(r, x);                                             // value at the latest sighting
    } else if (perDay) {
      if (e.curDay !== dayOf[i]) { for (const x of B.keys) { e.base[x] += e.cur[x]; e.cur[x] = 0; } e.curDay = dayOf[i]; }
      e.days.add(dayOf[i]);
      for (const x of B.keys) { e.cur[x] = fv(r, x); e.gain[x] = e.base[x] + e.cur[x]; }       // finished days + today's value so far
    } else if (i > 0) {
      const a = maps[i - 1].get(id);
      if (reset[i]) for (const x of B.keys) e.gain[x] += fv(r, x);                              // reset: everything since the reset
      else if (a) for (const x of B.keys) e.gain[x] += fv(r, x) - fv(a, x);                     // seen twice in a row: real difference
      else { e.est = true; e.gain[M] += Math.max(0, fv(r, M) - cutoff[i - 1]); }                // just entered: at least this much
    }
    e.cum.push([pts[i].at, e.gain[M]]);
  }
  const anyReset = reset.some(Boolean);
  const list = [...E.values()].map(e => {
    const first = maps[0].get(e.id), fin = maps[last].get(e.id);
    const status = e.lastIdx === last ? (e.firstIdx === 0 ? 'in' : 'new') : (e.firstIdx === 0 ? 'left' : 'passed');
    const firstRank = first?.rank ?? null, rank = fin?.rank ?? null;
    return { ...e, status, firstRank, rank,
             partial: exact ? e.lastIdx < last : perDay ? (e.days.size < totalDays || e.lastIdx < last) : (e.est || e.firstIdx > 0 || e.lastIdx < last),
             move: status === 'in' && !anyReset ? firstRank - rank : 0, value: fv(e.lastRow, M) };
  });
  return { list, anyReset, n };
}

// the 3 clans with the strongest position on a player board: biggest total score from members on the list (more members = more total)
function strongest(present, clanOf) {
  const m = new Map();
  for (const e of present) {
    const c = clanOf.get(e.id), tag = e.tag || c?.tag || '';
    if (!tag) continue;
    const t = m.get(tag) || { tag, color: e.color ?? c?.color ?? null, members: 0, total: 0 };
    t.members++; t.total += e.value; m.set(tag, t);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.members - a.members).slice(0, 3);
}

function summarize(board, span, pts, res, clanOf) {
  const B = BOARDS[board], { list, anyReset, n } = res, g = e => e.gain[B.metric];
  const present = list.filter(e => e.lastIdx === n - 1).sort((a, b) => a.rank - b.rank);
  const others = list.filter(e => e.lastIdx !== n - 1).sort((a, b) => g(b) - g(a));
  const all = [...present, ...others].slice(0, MAX_ALL).map(e => ({ id: e.id, name: e.name, tag: e.tag || clanOf.get(e.id)?.tag || '', color: e.color ?? clanOf.get(e.id)?.color ?? null,
    rank: e.rank, prevRank: e.firstRank, move: e.move, status: e.status, isNew: e.status === 'new', partial: e.partial, value: e.value, gain: g(e) }));
  const inList = list.filter(e => e.status === 'in' && !anyReset);
  const best = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);
  const pick = e => (e ? { name: e.name, move: e.move } : null);
  return {
    ok: true, span, unit: B.unit, reset: anyReset, at: new Date(pts[0].at).toISOString(), to: new Date(pts[n - 1].at).toISOString(),
    live: false, snapshots: n, elapsedMin: elapsedMin(pts),
    count: present.length, totalGain: list.reduce((s, e) => s + g(e), 0), gainers: list.filter(e => g(e) > 0).length,
    moved: inList.filter(e => e.move !== 0).length, up: inList.filter(e => e.move > 0).length, down: inList.filter(e => e.move < 0).length,
    entered: list.filter(e => e.status === 'new').length, left: list.filter(e => e.status === 'left').length,
    biggestClimb: inList.some(e => e.move > 0) ? pick(best(inList, e => e.move)) : null,
    biggestDrop: inList.some(e => e.move < 0) ? pick(best(inList, e => -e.move)) : null,
    strongest: B.kind === 'player' ? strongest(present, clanOf) : null,
    all,
    // lines for the graph: running total gained since the start, for the 50 entries with the biggest changes
    series: list.filter(e => g(e) !== 0).sort((a, b) => Math.abs(g(b)) - Math.abs(g(a))).slice(0, 50).map(e => ({ id: e.id, name: e.name, tag: e.tag, pts: e.cum })),
  };
}

// what the leaderboard pages need: for each entry on the newest list, its starting rank and its gain for every column
async function prevFor(board, span) {
  const pts = await pointsFor(board, span);
  if (!pts) return { board, span, at: null, elapsedMin: null, reset: false, entries: null };
  const { list, anyReset, n } = chain(board, span, pts), entries = {};
  for (const e of list) if (e.lastIdx === n - 1) entries[e.id] = { rank: e.firstRank, status: e.status, partial: e.partial, d: e.gain };
  return { board, span, at: new Date(pts[0].at).toISOString(), elapsedMin: elapsedMin(pts), reset: anyReset, entries };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Community Vote has its own cookie, status codes and caching, so it answers the request itself
    if (req.query.mode === 'vote') return voteHandler(req, res);

    const { mode, board } = req.query;
    const span = req.query.span === 'day' || req.query.span === 'week' ? req.query.span : 'hour';
    const date = span !== 'hour' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : undefined;
    if (date && dayStartOf(date) > Date.now()) return res.status(400).json({ error: 'date is in the future' });
    const pastDay = date && dayStartOf(date) + DAY <= Date.now();
    let data;
    if (mode === 'prev') {
      if (!BOARDS[board]) return res.status(400).json({ error: 'board must be day, week, ranked or clan' });
      data = await prevFor(board, span);
    } else if (mode === 'summary') {
      // borrow clan tags from the newest daily + ranked snapshots in case a board row has none (same players)
      const [dl, rl] = await Promise.all([latestRows('day'), latestRows('ranked')]), clanOf = new Map();
      for (const r of [...rl, ...dl]) if (r.clan_tag) clanOf.set(r.player_id, { tag: r.clan_tag, color: r.clan_color ?? null });
      const out = {};
      await Promise.all(Object.keys(BOARDS).map(async b => {
        try {
          const pts = await pointsFor(b, span, date);
          out[b] = pts ? summarize(b, span, pts, chain(b, span, pts), clanOf) : { ok: false, unit: BOARDS[b].unit };
        } catch (e) { console.error(`summary ${b} failed:`, e.message); out[b] = { ok: false, unit: BOARDS[b].unit }; }
      }));
      data = { generatedAt: new Date().toISOString(), span, date: date || null, boards: out };
    } else if (mode === 'clan-updates') {
      data = await clanUpdates(req.query);
    } else if (mode === 'player-updates') {
      data = await playerUpdates(req.query);
    } else return res.status(400).json({ error: 'unknown mode' });
    res.setHeader('Cache-Control', pastDay ? 'public, s-maxage=3600, stale-while-revalidate=86400'
      : span === 'week' ? 'public, s-maxage=900, stale-while-revalidate=1800'
      : 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
