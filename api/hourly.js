// "What changed in the past hour". Compares the LIVE API values with the stored JSON snapshot from about 1 hour ago
// (raw_snapshots, written by the hourly collector).
//   /api/hourly?mode=prev&board=day|week|ranked|clan&span=hour|day  -> the comparison snapshot as { id: { rank, ...values } }  (pages compute their own +/- from it)
//   /api/hourly?mode=summary&span=hour|day                          -> ready-made totals + every entry's gain and position change (sidebar + Past hour page)
// span=hour: the stored snapshot closest to 1 hour ago.  span=day: the FIRST stored snapshot after 00:00 UTC today (so "today so far").
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { URLS, rest, extractList, fetchLive, normPlayer, normClan } from './_lib/shared.js';

const BOARDS = {
  day:    { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true },    // daily + weekly boards reset to 0 (we detect that)
  week:   { kind: 'player', metric: 'kills',    unit: 'kills',    resets: true },
  ranked: { kind: 'player', metric: 'trophies', unit: 'trophies', resets: false },
  clan:   { kind: 'clan',   metric: 'kills',    unit: 'kills',    resets: false },
};
const MIN = 60e3;

// raw API entries -> ranked rows. Players keep the API's order; clans are ranked by kills (same as the Clan Rankings page).
function toRows(kind, payload) {
  const list = extractList(payload, kind === 'clan' ? 'clanId' : 'playerId');
  if (!list) return null;
  if (kind === 'clan') return list.map(normClan).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)).map((r, i) => ({ ...r, rank: i + 1 }));
  return list.map(normPlayer);
}
const idKey = kind => (kind === 'clan' ? 'clan_id' : 'player_id');
const vals = (kind, r) => (kind === 'clan'
  ? { rank: r.rank, kills: r.kills, members: r.member_count }
  : { rank: r.rank, kills: r.kills, deaths: r.deaths, trophies: r.trophies, wins: r.ranked_wins, losses: r.ranked_losses });

// span 'hour': the stored snapshot closest to "1 hour ago" (looks between 30 minutes and 2.5 hours back)
// span 'day':  the first stored snapshot at or after 00:00 UTC today
async function prevSnapshot(url, span) {
  const now = Date.now(), enc = encodeURIComponent;
  let best;
  if (span === 'day') {
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
    [best] = await rest(`raw_snapshots?select=id,fetched_at&url=eq.${enc(url)}&fetched_at=gte.${enc(midnight.toISOString())}&order=fetched_at.asc&limit=1`);
  } else {
    const lo = new Date(now - 150 * MIN).toISOString(), hi = new Date(now - 30 * MIN).toISOString();
    const metas = await rest(`raw_snapshots?select=id,fetched_at&url=eq.${enc(url)}&fetched_at=gte.${enc(lo)}&fetched_at=lte.${enc(hi)}&order=fetched_at.desc&limit=20`);
    if (metas.length) best = metas.reduce((a, b) => Math.abs(now - Date.parse(b.fetched_at) - 60 * MIN) < Math.abs(now - Date.parse(a.fetched_at) - 60 * MIN) ? b : a);
  }
  if (!best) return null;
  const [row] = await rest(`raw_snapshots?select=payload&id=eq.${best.id}`);
  return row ? { at: best.fetched_at, elapsedMin: Math.round((now - Date.parse(best.fetched_at)) / MIN), payload: row.payload } : null;
}

async function prevFor(board, span) {
  const B = BOARDS[board], snap = await prevSnapshot(URLS[board], span);
  const rows = snap && toRows(B.kind, snap.payload);
  if (!rows) return { board, span, at: null, elapsedMin: null, entries: null };
  const entries = {};
  for (const r of rows.slice(0, 300)) entries[r[idKey(B.kind)]] = vals(B.kind, r);
  return { board, span, at: snap.at, elapsedMin: snap.elapsedMin, entries };
}

function summarize(board, cur, prev) {
  const B = BOARDS[board], k = idKey(B.kind), top = cur.slice(0, 50);
  if (!prev || !prev.entries) return { ok: false, unit: B.unit };
  let list = top.map(r => {
    const p = prev.entries[r[k]];
    return { id: r[k], name: r.name, tag: r.clan_tag ?? r.tag ?? '', rank: r.rank, prevRank: p?.rank ?? null, isNew: !p,
             value: r[B.metric], gain: p ? (r[B.metric] ?? 0) - (p[B.metric] ?? 0) : null };
  });
  // a daily/weekly board that just reset makes every "gain" negative: hide the changes instead of showing nonsense
  const known = list.filter(x => x.gain != null);
  const reset = B.resets && known.length > 0 && known.filter(x => x.gain < 0).length / known.length > 0.5;
  if (reset) list = list.map(x => ({ ...x, gain: null, prevRank: null, isNew: false }));
  list = list.map(x => ({ ...x, move: x.prevRank != null ? x.prevRank - x.rank : 0 }));
  const gains = list.filter(x => x.gain != null);
  const best = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);
  return {
    ok: true, reset, span: prev.span, unit: B.unit, at: prev.at, elapsedMin: prev.elapsedMin, count: list.length,
    totalGain: gains.reduce((s, x) => s + x.gain, 0),
    gainers: gains.filter(x => x.gain > 0).length,
    moved: list.filter(x => x.move !== 0).length, up: list.filter(x => x.move > 0).length, down: list.filter(x => x.move < 0).length,
    entered: list.filter(x => x.isNew).length,
    biggestClimb: list.some(x => x.move > 0) ? best(list, x => x.move) : null,
    biggestDrop: list.some(x => x.move < 0) ? best(list, x => -x.move) : null,
    all: list,
  };
}

async function liveRows(board) {
  const B = BOARDS[board];
  try { return toRows(B.kind, await fetchLive(URLS[board])) || []; }
  catch (e) { console.error(`live ${board} failed:`, e.message); return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { mode, board } = req.query;
    const span = req.query.span === 'day' ? 'day' : 'hour';
    let data;
    if (mode === 'prev') {
      if (!BOARDS[board]) return res.status(400).json({ error: 'board must be day, week, ranked or clan' });
      data = await prevFor(board, span);
    } else if (mode === 'summary') {
      const keys = Object.keys(BOARDS), out = {};
      await Promise.all(keys.map(async b => {
        try {
          const [cur, prev] = await Promise.all([liveRows(b), prevFor(b, span)]);
          out[b] = cur.length ? summarize(b, cur, prev) : { ok: false, unit: BOARDS[b].unit };
        } catch (e) { console.error(`summary ${b} failed:`, e.message); out[b] = { ok: false, unit: BOARDS[b].unit }; }
      }));
      data = { generatedAt: new Date().toISOString(), span, boards: out };
    } else return res.status(400).json({ error: 'unknown mode' });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');   // keeps database + live API load low
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
