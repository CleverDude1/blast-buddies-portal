// /api/stats  -> everything the Statistics page needs in one call:
//   level100 (players ever seen at level 100+), records (all-time highs), guns (favourite-weapon counts per board),
//   lifetime (top 3 lifetime kills, top 3 lifetime KDR, top 3 kills with each gun)
// DATA SOURCE: the old per-board APIs are gone and the Pangolin API only allows 1 request per 5 minutes per IP, so this file never calls
// it. "Live" data = the newest stored snapshot per board (raw_snapshots, written hourly by api/collect.js). Records are updated by the
// collector itself, so this file only READS them.
// /api/stats?mode=sample   -> called by the Supabase cron once an hour (:55) (Bearer secret): runs the clan league tick, stores one online-players sample + updates the all-time peak
// /api/stats?mode=league   -> the open clan league day + roster (league.html)
// /api/stats?mode=weapons  -> favourite weapon of the players on each board (weapons.html)
// /api/stats?mode=player-list    -> every row of the permanent `players` table (players.html)
// /api/stats?mode=player&id=ID   -> name / clan / weapon change history of one player (players.html details popup)
// /api/stats?mode=backfill&key=ADMIN_KEY[&after=ID]  -> one-off: rebuild records + level 100 from stored raw_snapshots
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, STATS_ADMIN_KEY (only for backfill)
import { rest, extractList, ID_RE } from './_lib/shared.js';
import { loadStats, backfill, loadPeak, loadOnline, loadSamples, loadPlayers, backfillPlayers, roomTotals, addOnlineSample, updatePeak } from './_lib/records.js';
import { leagueTick, loadLeague } from './_lib/league.js';

export const config = { maxDuration: 60 };

// raw_snapshots.source written by api/collect.js
const SOURCE = { day: 'leaderboard-day', week: 'leaderboard-week', ranked: 'leaderboard-ranked', clan: 'clan' };
// how many players per board are counted for "most popular guns" (ranked has 500; rows without a weapon are skipped)
const GUN_ROWS = { day: 100, week: 100, ranked: 500 };
// weapon ids with a lifetime "most kills" list (matches js/weapon-names.js; 101 = knife)
const WEAPON_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 101];
const enc = encodeURIComponent;

async function latestPayload(board) {
  const [row] = await rest(`raw_snapshots?select=fetched_at,payload&source=eq.${enc(SOURCE[board])}&order=fetched_at.desc&limit=1`);
  return row ? { at: Date.parse(row.fetched_at), payload: row.payload } : null;
}

// main weapon of each player on a board -> { total, list: [{ id, count }] } (total = players that have a weapon on record)
function gunCounts(payload, max) {
  const rows = (payload && extractList(payload, 'playerId')) || [], counts = new Map();
  let total = 0;
  for (const r of rows.slice(0, max)) {
    if (r.topWeaponId == null) continue;
    total++; counts.set(r.topWeaponId, (counts.get(r.topWeaponId) || 0) + 1);
  }
  return { total, list: [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id - b.id) };
}

async function gunsFromStored(boards) {
  const guns = {};
  await Promise.all(boards.map(async b => {
    try { const s = await latestPayload(b); guns[b] = s ? gunCounts(s.payload, GUN_ROWS[b]) : { total: 0, list: [] }; }
    catch (e) { console.error(`guns ${b} failed:`, e.message); guns[b] = { total: 0, list: [] }; }
  }));
  return guns;
}

// top 3 lifetime kills, top 3 lifetime KDR (min 1,000 kills) and top 3 kills with each gun, from player_lifetime / player_weapon_stats.
// Each list falls back to [] on its own, so the page still works before the tables exist.
async function loadLifetime() {
  const cols = 'player_id,name,clan_tag,clan_color,kills,deaths,games,kdr';
  const safe = p => p.catch(e => { console.error('lifetime query failed:', e.message); return []; });
  const [kills, kdr, ...perGun] = await Promise.all([
    safe(rest(`player_lifetime?select=${cols}&order=kills.desc&limit=3`)),
    safe(rest(`player_lifetime?select=${cols}&kills=gte.1000&order=kdr.desc&limit=3`)),
    ...WEAPON_IDS.map(id => safe(rest(
      `player_weapon_stats?select=player_id,kills,headshots,player_lifetime(name,clan_tag,clan_color)&weapon_id=eq.${id}&kills=gt.0&order=kills.desc&limit=3`))),
  ]);
  const weapons = {};
  WEAPON_IDS.forEach((id, i) => {
    weapons[id] = (perGun[i] || []).map(r => ({ player_id: r.player_id, kills: r.kills, headshots: r.headshots,
      name: r.player_lifetime?.name ?? r.player_id, clan_tag: r.player_lifetime?.clan_tag ?? '', clan_color: r.player_lifetime?.clan_color ?? null }));
  });
  return { kills, kdr, weapons };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (req.query.mode === 'sample') {            // lives here (not in its own file) to stay under the 12 serverless function limit
      const secret = process.env.YOUR_ACTUAL_CRON_SECRET;
      if (!secret) return res.status(500).json({ error: 'YOUR_ACTUAL_CRON_SECRET is not set' });
      if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
      res.setHeader('Cache-Control', 'no-store');
      const at = Date.now();
      let league = null;                            // clan league: runs first so a rooms problem never skips it
      try {
        const clans = await latestPayload('clan');  // newest stored clan snapshot (the collector fetches the Pangolin API)
        league = clans ? await leagueTick(clans.payload, at) : 'no clan snapshot yet';
      } catch (e) { console.error('league tick failed:', e.message); league = 'error: ' + e.message; }
      const base = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(`${base}/api/rooms`, { signal: ctrl.signal, headers: { 'user-agent': 'blast-buddies-collector', 'cache-control': 'no-cache' } });
        if (!r.ok) throw new Error('rooms HTTP ' + r.status);
        const tot = roomTotals(await r.json());
        if (tot.ok < 3) return res.status(502).json({ error: `only ${tot.ok} of 3 regions answered`, league });   // a missing region would make the total look too low
        await addOnlineSample(tot, at);
        await updatePeak(tot, at);
        return res.status(200).json({ ok: true, total: tot.total, na: tot.na, eu: tot.eu, as: tot.as, rooms: tot.rooms, league });
      } finally { clearTimeout(timer); }
    }
    if (req.query.mode === 'league') {            // clan league page
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json(await loadLeague());
    }
    if (req.query.mode === 'weapons') {           // Weapons page: favourite weapon of the players on each board
      const guns = await gunsFromStored(['day', 'week', 'ranked']);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).json({ guns });
    }
    if (req.query.mode === 'backfill-players') {   // one-off: fill/repair the permanent players table from stored snapshots
      if (!process.env.STATS_ADMIN_KEY || req.query.key !== process.env.STATS_ADMIN_KEY)
        return res.status(401).json({ error: 'Set STATS_ADMIN_KEY in Vercel and pass it as ?key=' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await backfillPlayers(Number(req.query.after) || 0));
    }
    if (req.query.mode === 'backfill') {
      if (!process.env.STATS_ADMIN_KEY || req.query.key !== process.env.STATS_ADMIN_KEY)
        return res.status(401).json({ error: 'Set STATS_ADMIN_KEY in Vercel and pass it as ?key=' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await backfill(Number(req.query.after) || 0));
    }
    if (req.query.mode === 'player-list') {       // Player Database page: the whole permanent `players` table (the page sorts and filters it)
      const players = await rest('players?select=player_id,name,total_xp,top_weapon_id,clan_tag,clan_color,first_seen_at,last_seen_at&order=total_xp.desc.nullslast,player_id.asc', { all: true, max: 100000 });
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json({ count: players.length, players });
    }
    if (req.query.mode === 'player') {            // one player's change history (names, clans, weapons)
      const id = String(req.query.id || '');
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad player id' });
      const history = await rest(`player_history?select=change_type,changes,observed_at&player_id=eq.${enc(id)}&order=observed_at.desc&limit=200`);
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json({ history });
    }
    if (req.query.mode === 'players') {           // id -> name lookup: /api/stats?mode=players&ids=id1,id2,...
      const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean);
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json({ players: await loadPlayers(ids) });
    }
    if (req.query.mode === 'activity') {          // Player Activity page: hourly online samples for the last N days
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      const [samples, peak] = await Promise.all([loadSamples(days), loadPeak().catch(() => null)]);
      return res.status(200).json({ days, samples, peak });
    }
    if (req.query.mode === 'online') {          // light call: the 24-hour online samples + all-time peak (both filled by api/online.js)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      const [samples, peak] = await Promise.all([loadOnline().catch(() => []), loadPeak().catch(() => null)]);
      return res.status(200).json({ samples, peak });
    }
    // main call: records are written by the collector, so this only reads
    const now = Date.now();
    const [stats, online, guns, lifetime] = await Promise.all([
      loadStats(),
      loadOnline().catch(() => []),
      gunsFromStored(['day', 'week', 'ranked']),
      loadLifetime(),
    ]);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ updatedAt: new Date(now).toISOString(), ...stats, online, guns, lifetime });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
