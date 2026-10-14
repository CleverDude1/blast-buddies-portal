// /api/stats  -> everything the Statistics page needs in one call:
//   level100 (players ever seen at level 100+), records (all-time highs), guns (top-50 weapon counts per board)
// Every call also checks the live boards against the stored records and replaces any that were beaten.
// /api/stats?mode=backfill&key=ADMIN_KEY[&after=ID]  -> one-off: rebuild records + level 100 from stored raw_snapshots
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, STATS_ADMIN_KEY (only for backfill)
import { URLS, fetchLive } from './_lib/shared.js';
import { collect, commit, loadStats, weaponCounts, backfill, roomTotals, updatePeak, loadPeak, hourAgo } from './_lib/records.js';

export const config = { maxDuration: 60 };
const BOARDS = ['day', 'week', 'ranked', 'clan'];

// reads your own /api/rooms and raises the all-time "players online" peak if the current total beats it
async function checkPeak(req) {
  try {
    const url = process.env.ROOMS_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/rooms`;
    const r = await fetch(url); if (!r.ok) throw new Error('rooms HTTP ' + r.status);
    return await updatePeak(roomTotals(await r.json()));
  } catch (e) { console.error('peak check failed:', e.message); return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (req.query.mode === 'backfill') {
      if (!process.env.STATS_ADMIN_KEY || req.query.key !== process.env.STATS_ADMIN_KEY)
        return res.status(401).json({ error: 'Set STATS_ADMIN_KEY in Vercel and pass it as ?key=' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await backfill(Number(req.query.after) || 0));
    }
    if (req.query.mode === 'online') {          // light call the page makes every minute so peaks are not missed
      await checkPeak(req);
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({ peak: await loadPeak().catch(() => null) });
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
    await checkPeak(req);
    const stats = await loadStats();
    const guns = {};
    for (const b of ['day', 'week', 'ranked']) guns[b] = live[b] ? weaponCounts(live[b]) : { total: 0, list: [] };
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ updatedAt: new Date(now).toISOString(), ...stats, guns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
