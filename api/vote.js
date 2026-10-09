// Community Vote. GET -> { voted:false, items } or { voted:true, total, results }. POST { tiers } -> submits one ballot.
// One ballot per cookie per poll (DB unique constraint) + max 3 per hashed IP/user-agent.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, VOTE_SALT
import crypto from 'crypto';

const POLL = 'season-3';           // change per season (and add a row to vote_polls) so everyone can vote again
const MAX_PER_IP = 3;
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const ITEMS = {
  maps: ['MAP NAMES HERE'],        // <-- paste your map names
  primary: ['Assault','Bow','Burst','Lmg','MAC-10','Shotgun','Sniper','Thompson','UMP-45'],
  secondary: ['Energy','Flare','Pistol','RayGun','Revolver','Snare'],
  grenades: ['BlackHole','Flashbang','Inferno','Shockwave','Smoke','Storm','Updraft','Warp'],
};

const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent;

async function get(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function count(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } });
  return Number((r.headers.get('content-range') || '*/0').split('/')[1]) || 0;
}
const cookieOf = req => (req.headers.cookie || '').split('; ').find(c => c.startsWith('bb_voter='))?.split('=')[1];

async function results() {
  const [total, rows] = await Promise.all([count(`ballots?poll_id=eq.${POLL}`), get(`vote_results?poll_id=eq.${POLL}`)]);
  const out = {};
  for (const r of rows) (out[r.category] ||= []).push({
    item: r.item,
    pctTop: total ? Math.round((r.top_votes / total) * 1000) / 10 : 0,   // % of ALL voters who put it in S or A
    avgScore: Number(r.avg_score),
  });
  for (const k in out) out[k].sort((a, b) => b.pctTop - a.pctTop || b.avgScore - a.avgScore);
  return { total, results: out };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let id = cookieOf(req);
    if (!id) {
      id = crypto.randomUUID();
      res.setHeader('Set-Cookie', `bb_voter=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
    }
    const voted = (await count(`ballots?poll_id=eq.${POLL}&cookie_id=eq.${enc(id)}`)) > 0;

    if (req.method === 'GET') {
      return res.status(200).json(voted ? { voted: true, ...(await results()) } : { voted: false, items: ITEMS, tiers: TIERS });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (voted) return res.status(409).json({ voted: true, ...(await results()) });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ipHash = crypto.createHash('sha256').update(`${ip}|${req.headers['user-agent'] || ''}|${process.env.VOTE_SALT}`).digest('hex');
    if ((await count(`ballots?poll_id=eq.${POLL}&ip_hash=eq.${ipHash}`)) >= MAX_PER_IP)
      return res.status(429).json({ error: 'Too many votes from this device or network.' });

    // only accept known items and tiers
    const rows = [];
    for (const [category, picks] of Object.entries(req.body?.tiers || {})) {
      if (!ITEMS[category]) continue;
      for (const [item, tier] of Object.entries(picks || {}))
        if (ITEMS[category].includes(item) && TIERS.includes(tier)) rows.push({ category, item, tier });
    }
    if (rows.length < 3) return res.status(400).json({ error: 'Place at least 3 items before submitting.' });

    const b = await fetch(`${SB}/rest/v1/ballots`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ poll_id: POLL, cookie_id: id, ip_hash: ipHash }),
    });
    if (b.status === 409) return res.status(409).json({ voted: true, ...(await results()) }); // double submit
    if (!b.ok) throw new Error(await b.text());
    const [{ id: ballotId }] = await b.json();

    const it = await fetch(`${SB}/rest/v1/ballot_items`, {
      method: 'POST', headers: H, body: JSON.stringify(rows.map(r => ({ ...r, ballot_id: ballotId }))),
    });
    if (!it.ok) {                                                   // don't leave an empty ballot that blocks a retry
      await fetch(`${SB}/rest/v1/ballots?id=eq.${ballotId}`, { method: 'DELETE', headers: H });
      throw new Error(await it.text());
    }
    return res.status(200).json({ voted: true, ...(await results()) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
