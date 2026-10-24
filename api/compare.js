// Read-only endpoint for the CLAN part of the Compare page.
//   /api/compare?mode=options&type=clan              -> which clans can be compared
//   /api/compare?mode=compare&type=clan&a=ID&b=ID    -> current values + averages
//   /api/compare?mode=series&type=clan&a=ID&b=ID     -> history rows for the graphs
// PLAYERS are compared from the permanent `players` table through /api/stats?mode=compare-options | compare-players | compare-series.
//
// CURRENT VALUES come from the newest stored clan snapshot (raw_snapshots, written hourly by api/collect.js from the combined Pangolin API).
// The Pangolin API only allows 1 request per 5 minutes per IP, so this file never calls it.
// A clan that is not in that snapshot (top 100) falls back to its last stored values in the `clans` table, marked "last seen".
// Averages and graphs come from Supabase history. Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { ID_RE, rest, inList, since, extractList, normClan } from './_lib/shared.js';

// the newest stored clan snapshot = the current clan leaderboard (top 100)
async function liveClans() {
  try {
    const [row] = await rest('raw_snapshots?select=fetched_at,payload&source=eq.clan&order=fetched_at.desc&limit=1');
    const list = row && extractList(row.payload, 'clanId');
    if (!list) throw new Error('no clan snapshot stored yet');
    return list.map(normClan);
  } catch (e) { console.error('latest clans failed:', e.message); return []; }
}

// ---------- who can be compared ----------
// every clan the tracker has stored (not just today's top 100), biggest first; today's snapshot if the table is empty
async function clanOptions() {
  const rows = await rest('clans?select=clan_id,name,tag,kills&order=kills.desc.nullslast&limit=1000').catch(() => []);
  const list = rows.length ? rows : (await liveClans()).sort((x, y) => (y.kills ?? -1) - (x.kills ?? -1));
  return list.filter(c => ID_RE.test(c.clan_id || '')).map(c => ({ id: c.clan_id, name: c.name || c.clan_id, tag: c.tag || '', kills: c.kills }));
}

// ---------- current values + averages ----------
async function compareClans(a, b) {
  const pair = inList([a, b]);
  const pop = await liveClans(), fallback = {};
  const missing = [a, b].filter(id => !pop.some(c => c.clan_id === id));
  let stored = [];
  if (missing.length) {
    stored = await rest(`clans?select=clan_id,name,tag,color,member_count,member_cap,open_join,kills,last_seen_at&clan_id=${inList(missing)}`).catch(() => []);
    for (const r of stored) fallback[r.clan_id === a ? 'a' : 'b'] = { ...r, _at: r.last_seen_at };
  }
  const averages = await rest(`clan_board_averages?clan_id=${pair}`).catch(e => { console.error('averages failed:', e.message); return []; });
  const all = [...pop, ...stored];
  const who = id => { const c = all.find(x => x.clan_id === id); return { id, name: c?.name || id, tag: c?.tag || '' }; };
  return { type: 'clan', info: { a: who(a), b: who(b) }, pop, fallback, averages };
}

// ---------- history for the graphs ----------
// Reads EVERY hourly snapshot from entry_snapshots (filled by supabase/hourly-snapshots.sql).
// If a clan has no snapshots yet, falls back to the change-only history table.
const snapRows = async (kind, season, id, days, cols, max) =>
  (await rest(`entry_snapshots?select=taken_at,${cols}&kind=eq.${kind}&season=eq.${season}&entity_id=eq.${id}&taken_at=gte.${since(days)}&order=taken_at.desc`,
    { all: true, max })).reverse().map(({ taken_at, ...r }) => ({ observed_at: taken_at, ...r }));   // oldest -> newest

async function clanRows(days, id) {
  const rows = await snapRows('clan', 0, id, days, 'kills,member_count', 9000);
  if (rows.length) return rows;
  return rest(`clan_history?select=observed_at,kills,member_count&clan_id=eq.${id}&observed_at=gte.${since(days)}&order=observed_at.desc`, { all: true, max: 9000 })
    .then(r => r.reverse());
}
async function seriesClans(a, b) {
  const [ra, rb] = await Promise.all([a, b].map(id => clanRows(365, id)));
  return { clan: { a: ra, b: rb } };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { mode, type, a, b } = req.query;
    if (type === 'player') return res.status(400).json({ error: 'players are compared through /api/stats?mode=compare-players' });
    if (type !== 'clan') return res.status(400).json({ error: 'type must be clan' });
    let data;
    if (mode === 'options') data = await clanOptions();
    else if (mode === 'compare' || mode === 'series') {
      if (!ID_RE.test(a || '') || !ID_RE.test(b || '')) return res.status(400).json({ error: 'a and b must be valid ids' });
      data = mode === 'compare' ? await compareClans(a, b) : await seriesClans(a, b);
    } else return res.status(400).json({ error: 'unknown mode' });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');   // protects the database
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
