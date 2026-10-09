// "What changed". Works out gains and position changes from the stored JSON snapshots (raw_snapshots) plus the live API.
//   /api/hourly?mode=prev&board=day|week|ranked|clan&span=hour|day   -> per-entry gains for the leaderboard pages (+2k labels, arrows)
//   /api/hourly?mode=summary&span=hour|day[&date=YYYY-MM-DD]          -> totals, every entry's gain/position change, strongest clans, graph lines
//
// span=hour : the stored snapshot closest to 1 hour ago  ->  live.
// span=day  : EVERY stored snapshot from 00:00 UTC today ->  live.   With &date=...: every snapshot of that past day, 00:00 to 00:00 UTC.
//
// Why every snapshot: only the top 50 are stored, so people enter and leave the list during the day. Gains are added up snapshot by
// snapshot for everyone who shows up at any point, so nobody is dropped just because they were not on the list at the start.
//   - seen in two snapshots in a row: the real difference is counted
//   - enters the list: we only know they were below the previous cut-off, so at least (their value - the lowest value on the previous list)
//     is counted -> marked partial (~)
//   - leaves the list: nothing is counted after that -> marked partial (~)
//   - a daily/weekly board that reset between two snapshots: values since the reset are counted
// The DAILY board is the exception for span=day: it starts at 0 at 00:00 UTC, so a player's value IS what they gained that day.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { URLS, rest, extractList, fetchLive, normPlayer, normClan } from './_lib/shared.js';
import { clanUpdates } from './_lib/clan-updates.js';


const BOARDS = {
  day:    { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true,  keys: ['kills', 'deaths'] },
  week:   { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true,  keys: ['kills', 'deaths'] },
  ranked: { kind: 'player', metric: 'trophies', unit: 'trophies', resets: false, keys: ['trophies', 'wins', 'losses'] },
  clan:   { kind: 'clan',   metric: 'kills',    unit: 'kills',    resets: false, keys: ['kills', 'members'] },
};
const MIN = 60e3, DAY = 864e5;
const FIELD = { wins: 'ranked_wins', losses: 'ranked_losses', members: 'member_count' };
const fv = (r, x) => Number(r[FIELD[x] ?? x] ?? 0) || 0;
const idKey = kind => (kind === 'clan' ? 'clan_id' : 'player_id');

// raw API payload -> ranked rows. Players keep the API's order; clans are ranked by kills (same as the Clan Rankings page).
function toRows(kind, payload) {
  const list = extractList(payload, kind === 'clan' ? 'clanId' : 'playerId');
  if (!list) return null;
  if (kind === 'clan') return list.map(normClan).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)).map((r, i) => ({ ...r, rank: i + 1 }));
  return list.map(normPlayer);
}
async function liveRows(board) {
  try { return toRows(BOARDS[board].kind, await fetchLive(URLS[board])) || []; }
  catch (e) { console.error(`live ${board} failed:`, e.message); return []; }
}

// ---------- reading stored snapshots ----------
const enc = encodeURIComponent;
async function hourSnapshot(url) {                       // closest to 1 hour ago (looks 30 min to 2.5 h back)
  const now = Date.now();
  const lo = new Date(now - 150 * MIN).toISOString(), hi = new Date(now - 30 * MIN).toISOString();
  const metas = await rest(`raw_snapshots?select=id,fetched_at&url=eq.${enc(url)}&fetched_at=gte.${enc(lo)}&fetched_at=lte.${enc(hi)}&order=fetched_at.desc&limit=20`);
  if (!metas.length) return null;
  const best = metas.reduce((a, b) => Math.abs(now - Date.parse(b.fetched_at) - 60 * MIN) < Math.abs(now - Date.parse(a.fetched_at) - 60 * MIN) ? b : a);
  const [row] = await rest(`raw_snapshots?select=payload&id=eq.${best.id}`);
  return row ? { at: Date.parse(best.fetched_at), payload: row.payload } : null;
}
async function snapshotsBetween(url, fromMs, toMs) {     // every stored snapshot in [from, to), oldest first
  const rows = await rest(`raw_snapshots?select=fetched_at,payload&url=eq.${enc(url)}&fetched_at=gte.${enc(new Date(fromMs).toISOString())}&fetched_at=lt.${enc(new Date(toMs).toISOString())}&order=fetched_at.asc`, { all: true, max: 200 });
  return rows.map(r => ({ at: Date.parse(r.fetched_at), payload: r.payload }));
}
const dayStartOf = dateStr => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// the points in time to walk through: [{ at, rows, live? }, ...] oldest first (null if there is not enough data)
async function pointsFor(board, span, dateStr) {
  const B = BOARDS[board], url = URLS[board], now = Date.now();
  const point = (at, payload) => { const rows = toRows(B.kind, payload); return rows && rows.length ? { at, rows } : null; };
  if (span === 'hour') {
    const snap = await hourSnapshot(url), p0 = snap && point(snap.at, snap.payload), live = await liveRows(board);
    return p0 && live.length ? [p0, { at: now, rows: live, live: true }] : null;
  }
  const start = dayStartOf(dateStr), end = start + DAY, isToday = now >= start && now < end;
  const snaps = await snapshotsBetween(url, start, isToday ? now + 1 : end);
  const pts = snaps.map(s => point(s.at, s.payload)).filter(Boolean);
  if (isToday) { const live = await liveRows(board); if (live.length) pts.push({ at: now, rows: live, live: true }); }
  return pts.length >= 2 ? pts : null;
}

// ---------- the engine: add up the changes snapshot by snapshot ----------
function chain(board, span, pts) {
  const B = BOARDS[board], k = idKey(B.kind), M = B.metric, n = pts.length, last = n - 1;
  const exact = board === 'day' && span === 'day';          // daily board: value = what was gained today
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
    if (!e) E.set(id, e = { id, firstIdx: i, est: false, gain: Object.fromEntries(B.keys.map(x => [x, 0])), cum: [] });
    e.name = r.name ?? e.name; e.tag = r.clan_tag ?? r.tag ?? e.tag ?? ''; e.color = r.clan_color ?? r.color ?? e.color ?? null;
    e.lastIdx = i; e.lastRow = r;
    if (exact) for (const x of B.keys) e.gain[x] = fv(r, x);                                    // value at the latest sighting
    else if (i > 0) {
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
    return { ...e, status, firstRank, rank, partial: exact ? e.lastIdx < last : (e.est || e.firstIdx > 0 || e.lastIdx < last),
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
  const all = [...present, ...others].slice(0, 150).map(e => ({ id: e.id, name: e.name, tag: e.tag || clanOf.get(e.id)?.tag || '', color: e.color ?? clanOf.get(e.id)?.color ?? null,
    rank: e.rank, prevRank: e.firstRank, move: e.move, status: e.status, isNew: e.status === 'new', partial: e.partial, value: e.value, gain: g(e) }));
  const inList = list.filter(e => e.status === 'in' && !anyReset);
  const best = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);
  const pick = e => (e ? { name: e.name, move: e.move } : null);
  return {
    ok: true, span, unit: B.unit, reset: anyReset, at: new Date(pts[0].at).toISOString(), to: new Date(pts[n - 1].at).toISOString(),
    live: !!pts[n - 1].live, snapshots: pts.filter(p => !p.live).length, elapsedMin: Math.round((Date.now() - pts[0].at) / MIN),
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

// what the leaderboard pages need: for each entry on the live list, its starting rank and its gain for every column
async function prevFor(board, span) {
  const pts = await pointsFor(board, span);
  if (!pts) return { board, span, at: null, elapsedMin: null, reset: false, entries: null };
  const { list, anyReset, n } = chain(board, span, pts), entries = {};
  for (const e of list) if (e.lastIdx === n - 1) entries[e.id] = { rank: e.firstRank, status: e.status, partial: e.partial, d: e.gain };
  return { board, span, at: new Date(pts[0].at).toISOString(), elapsedMin: Math.round((Date.now() - pts[0].at) / MIN), reset: anyReset, entries };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { mode, board } = req.query;
    const span = req.query.span === 'day' ? 'day' : 'hour';
    const date = span === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : undefined;
    if (date && dayStartOf(date) > Date.now()) return res.status(400).json({ error: 'date is in the future' });
    const pastDay = date && dayStartOf(date) + DAY <= Date.now();
    let data;
    if (mode === 'prev') {
      if (!BOARDS[board]) return res.status(400).json({ error: 'board must be day, week, ranked or clan' });
      data = await prevFor(board, span);
    } else if (mode === 'summary') {
      // the weekly API does not send clan tags, so borrow them from the daily + ranked boards (same players)
      const [dl, rl] = await Promise.all([liveRows('day'), liveRows('ranked')]), clanOf = new Map();
      for (const r of [...rl, ...dl]) if (r.clan_tag) clanOf.set(r.player_id, { tag: r.clan_tag, color: r.clan_color ?? null });
      const out = {};
      await Promise.all(Object.keys(BOARDS).map(async b => {
        try {
          const pts = await pointsFor(b, span, date);
          out[b] = pts ? summarize(b, span, pts, chain(b, span, pts), clanOf) : { ok: false, unit: BOARDS[b].unit };
        } catch (e) { console.error(`summary ${b} failed:`, e.message); out[b] = { ok: false, unit: BOARDS[b].unit }; }
      }));
      data = { generatedAt: new Date().toISOString(), span, date: date || null, boards: out };
    } else return res.status(400).json({ error: 'unknown mode' });
    res.setHeader('Cache-Control', pastDay ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
