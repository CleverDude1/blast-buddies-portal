// /api/stats  -> everything the Statistics page needs in one call:
//   level100 (players ever seen at level 100+), records (all-time highs), guns (top-50 weapon counts per board)
// Every call also checks the live boards against the stored records and replaces any that were beaten.
// /api/stats?mode=backfill&key=ADMIN_KEY[&after=ID]  -> one-off: rebuild records + level 100 from stored raw_snapshots
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, STATS_ADMIN_KEY (only for backfill)
import { URLS, fetchLive } from './_lib/shared.js';
import { collect, commit, loadStats, weaponCounts, backfill } from './_lib/records.js';

export const config = { maxDuration: 60 };
const BOARDS = ['day', 'week', 'ranked', 'clan'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (req.query.mode === 'backfill') {
      if (!process.env.STATS_ADMIN_KEY || req.query.key !== process.env.STATS_ADMIN_KEY)
        return res.status(401).json({ error: 'Set STATS_ADMIN_KEY in Vercel and pass it as ?key=' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await backfill(Number(req.query.after) || 0));
    }
    const live = {}, now = Date.now();
    await Promise.all(BOARDS.map(async b => {
      try { live[b] = await fetchLive(URLS[b]); } catch (e) { console.error(`live ${b} failed:`, e.message); live[b] = null; }
    }));
    try { await commit(collect(BOARDS.filter(b => live[b]).map(b => ({ board: b, payload: live[b], at: now }))), now); }
    catch (e) { console.error('record update failed:', e.message); }   // still show what is stored
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
