// OPTIONAL patch for api/compare.js — makes the clan "current values" come straight from the
// live game API (/api/clan JSON) instead of the Supabase `clans` table. If the live call fails,
// it falls back to Supabase exactly like today.
// Averages + graphs still come from Supabase history, so those only move when the collector runs.
//
// HOW: in api/compare.js, replace the whole `compareClans` function with the two functions below.

async function liveClans() {
  const base = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';
  const r = await fetch(`${base}/api/clan`, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`/api/clan ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : Array.isArray(j.top) ? j.top : [];
  const at = new Date().toISOString();
  return list.filter(c => c && c.clanId).map(c => ({
    clan_id: c.clanId, name: c.name, tag: c.tag, color: c.color,
    member_count: c.memberCount, member_cap: c.memberCap, open_join: c.openJoin,
    kills: c.kills, last_seen_at: at,
  }));
}

async function compareClans(a, b) {
  const pair = inList([a, b]);
  const live = await liveClans().catch(e => { console.error('live clans failed, using Supabase:', e.message); return null; });
  const [popDb, mine, avgs] = await Promise.all([
    live ? Promise.resolve([]) : rest(`clans?select=${CLAN_COLS}&order=kills.desc.nullslast&limit=50`),
    rest(`clans?select=${CLAN_COLS}&clan_id=${pair}`),          // fallback for a clan not in the live top 50
    rest(`clan_board_averages?clan_id=${pair}`),
  ]);
  const seen = new Set(), rows = [];
  for (const r of (live ? [...live, ...mine] : [...mine, ...popDb])) if (!seen.has(r.clan_id)) { seen.add(r.clan_id); rows.push(r); }
  const who = id => { const c = rows.find(x => x.clan_id === id); return { id, name: c?.name || id, tag: c?.tag || '' }; };
  return { type: 'clan', source: live ? 'live' : 'supabase', info: { a: who(a), b: who(b) }, pop: rows, averages: avgs };
}
