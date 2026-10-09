// Diffs consecutive clan snapshots -> clan_updates (the feed the Clan Updates page reads).
// clan_history is already written by collect.js (syncEntities), so it is not touched here.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY
import { URLS } from './shared.js';

const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const sbGet = async p => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const sbPost = async (p, rows) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(await r.text());
};

// payload shape: { data: { top: [ { tag, name, color, kills, clanId, openJoin, memberCap, memberCount } ] } }
const toMap = payload => {
  const list = payload?.data?.top;
  if (!Array.isArray(list)) return null;
  return new Map(list.map(c => [String(c.clanId), {
    name: c.name ?? null, tag: c.tag ?? null, color: c.color ?? null, members: c.memberCount ?? null, open: c.openJoin ?? null,
  }]));
};

function diff(a, b, na, nb) {
  const out = [];
  for (const [id, n] of nb) {
    const o = na.get(id); if (!o) continue;                       // only clans present in both snapshots
    const add = (kind, oldV, newV, delta = null) => out.push({
      clan_id: id, kind, observed_at: b.fetched_at, since_at: a.fetched_at, name: n.name, tag: n.tag,
      old_value: oldV, new_value: newV, delta, snapshot_id: b.id, run_id: b.run_id ?? null,
      search_text: [n.name, n.tag, o.name, o.tag].filter(Boolean).join(' ').toLowerCase(),
    });
    if (o.members != null && n.members != null && n.members !== o.members)
      add(n.members < o.members ? 'left' : 'joined', { members: o.members }, { members: n.members }, Math.abs(n.members - o.members));
    if ((o.name != null && n.name != null && o.name !== n.name) || (o.tag != null && n.tag != null && o.tag !== n.tag))
      add('renamed', { name: o.name, tag: o.tag }, { name: n.name, tag: n.tag });
    if (o.open != null && n.open != null && o.open !== n.open) add('access', { open: o.open }, { open: n.open });
    if (o.color != null && n.color != null && o.color !== n.color) add('color', { color: o.color }, { color: n.color });
  }
  return out;
}

// pairs = how many consecutive snapshot pairs to check (1 = latest only; use more once to backfill)
export async function recordClanUpdates(pairs = 1) {
  const snaps = (await sbGet(`raw_snapshots?select=id,run_id,fetched_at,payload&url=eq.${encodeURIComponent(URLS.clan)}&order=fetched_at.desc&limit=${pairs + 1}`)).reverse();
  let found = 0;
  for (let i = 1; i < snaps.length; i++) {
    const [a, b] = [snaps[i - 1], snaps[i]], na = toMap(a.payload), nb = toMap(b.payload);
    if (!na || !nb) continue;
    const rows = diff(a, b, na, nb); found += rows.length;
    // unique (clan_id, kind, snapshot_id) makes re-runs harmless
    if (rows.length) await sbPost('clan_updates?on_conflict=clan_id,kind,snapshot_id', rows);
  }
  return { snapshots: snaps.length, found };
}

// feed for the page: ?kind=all|left|joined|renamed|access|color &q=search &offset=0
export async function clanUpdates(q) {
  const limit = 50, offset = Math.max(0, parseInt(q.offset) || 0);
  let p = `clan_updates?select=id,clan_id,kind,observed_at,since_at,name,tag,old_value,new_value,delta&order=observed_at.desc,id.desc&limit=${limit + 1}&offset=${offset}`;
  if (['left', 'joined', 'renamed', 'access', 'color'].includes(q.kind)) p += `&kind=eq.${q.kind}`;
  const s = String(q.q || '').toLowerCase().replace(/[^\p{L}\p{N} _~-]/gu, '').trim();
  if (s) p += `&search_text=ilike.*${encodeURIComponent(s)}*`;
  const rows = await sbGet(p);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
