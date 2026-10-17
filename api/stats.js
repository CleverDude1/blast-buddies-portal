// /api/stats  -> everything the Statistics page needs in one call:
//   level100 (players ever seen at level 100+), records (all-time highs), guns (top-50 weapon counts per board)
// Every call also checks the live boards against the stored records and replaces any that were beaten.
// /api/stats?mode=sample   -> called by the Supabase cron once an hour (:55) (Bearer secret): runs the clan league tick, stores one online-players sample + updates the all-time peak
// /api/stats?mode=league   -> the open clan league day + roster (league.html)
// /api/stats?mode=weapons  -> main weapon of the top-50 players per board (weapons.html)
// /api/stats?mode=backfill&key=ADMIN_KEY[&after=ID]  -> one-off: rebuild records + level 100 from stored raw_snapshots
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, STATS_ADMIN_KEY (only for backfill)
import { URLS, fetchLive } from './_lib/shared.js';
import { collect, commit, loadStats, weaponCounts, backfill, loadPeak, loadOnline, loadSamples, loadPlayers, backfillPlayers, hourAgo, roomTotals, addOnlineSample, updatePeak } from './_lib/records.js';
import { leagueTick, loadLeague } from './_lib/league.js';

export const config = { maxDuration: 60 };
const BOARDS = ['day', 'week', 'ranked', 'clan'];

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
      try { league = await leagueTick(await fetchLive(URLS.clan), at); } catch (e) { console.error('league tick failed:', e.message); league = 'error: ' + e.message; }
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
    if (req.query.mode === 'weapons') {           // Weapons page: main weapon of the top-50 players per board
      const guns = {};
      await Promise.all(['day', 'week', 'ranked'].map(async b => {
        try { guns[b] = weaponCounts(await fetchLive(URLS[b])); } catch (e) { console.error(`weapons ${b} failed:`, e.message); guns[b] = { total: 0, list: [] }; }
      }));
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
    const live = {}, now = Date.now();
    await Promise.all(BOARDS.map(async b => {
      try { live[b] = await fetchLive(URLS[b]); } catch (e) { console.error(`live ${b} failed:`, e.message); live[b] = null; }
    }));
    try {
      const items = await Promise.all(BOARDS.filter(b => live[b]).map(async b => {
        let prev = null;
        try { prev = await hourAgo(URLS[b], now); } catch (e) { console.error(`hour-ago ${b} failed:`, e.message); }
        return { board: b, payload: live[b], at: now, prevPayload: prev?.payload, prevAt: prev?.at };
      }));
      await commit(collect(items), now);
    }
    catch (e) { console.error('record update failed:', e.message); }   // still show what is stored
    const stats = await loadStats(), online = await loadOnline().catch(() => []);
    const guns = {};
    for (const b of ['day', 'week', 'ranked']) guns[b] = live[b] ? weaponCounts(live[b]) : { total: 0, list: [] };
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ updatedAt: new Date(now).toISOString(), ...stats, online, guns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
