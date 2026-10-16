// /api/league -> the open league day + roster (what league.html shows).
// Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
import { extractList } from './shared.js';

const base = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1/';
const headers = () => ({ apikey: process.env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' });

// Call this from collect.js right after the clan snapshot is saved:  await leagueTick(clanPayload, Date.now());
export async function leagueTick(payload, at = Date.now()) {
  const clans = (extractList(payload, 'clanId') || []).map(c => ({ clanId: c.clanId, name: c.name, tag: c.tag || null, color: c.color ?? null, kills: Number(c.kills) }));
  if (!clans.length) return 'no clans';
  const r = await fetch(base() + 'rpc/league_tick', { method: 'POST', headers: headers(), body: JSON.stringify({ p_at: new Date(at).toISOString(), p_clans: clans }) });
  if (!r.ok) throw new Error('league_tick ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

const q = async path => { const r = await fetch(base() + path, { headers: headers() }); if (!r.ok) throw new Error(path + ' -> ' + r.status); return r.json(); };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const [day] = await q('league_days?select=*&status=eq.open&order=day.desc&limit=1');
    if (!day) return res.status(200).json({ day: null, clans: [] });
    const clans = await q(`league_roster?select=clan_id,name,tag,color,area,start_kills,last_kills,start_points&day=eq.${day.day}&order=area.asc,start_points.desc&limit=100`);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ day: day.day, season: day.season, updatedAt: day.updated_at, clans });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
}
