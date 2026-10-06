// Read-only endpoint for the Podium page. Reads Supabase with the SECRET key (server-side only).
//   /api/podium  ->  { medals: [...], players: { id: {...} }, clans: { id: {...} } }
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

async function rest(path, { all = false, max = 1000 } = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  const auth = key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};   // new sb_secret_ keys go in apikey only
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, ...auth, 'Range-Unit': 'items', Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    rows.push(...page);
    if (!all || page.length < 1000 || rows.length >= max) break;
  }
  return rows;
}
async function lookup(table, idCol, cols, ids) {          // fetch rows for a list of ids, 100 at a time
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await rest(`${table}?select=${cols}&${idCol}=in.(${ids.slice(i, i + 100).join(',')})`);
    rows.forEach(r => { out[r[idCol]] = r; });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const medals = await rest('medals?select=category,place,awarded_on,season,entity_id&order=awarded_on.desc', { all: true, max: 20000 });
    const ids = cat => [...new Set(medals.filter(m => (m.category === 'clan') === (cat === 'clan')).map(m => m.entity_id))].filter(i => ID_RE.test(i));
    const [players, clans] = await Promise.all([
      lookup('players', 'player_id', 'player_id,name,total_xp,top_weapon_id,clan_tag,clan_color', ids('player')),
      lookup('clans', 'clan_id', 'clan_id,name,tag,color,member_count,member_cap,kills', ids('clan')),
    ]);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ medals, players, clans });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
