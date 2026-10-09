// Diffs consecutive clan snapshots -> clan_updates (the feed) + clan_history. Env: SUPABASE_URL, SUPABASE_SECRET_KEY
import { extractList } from './shared.js';

const SOURCE = 'clan';          // raw_snapshots.source for the clan board
const WRITE_HISTORY = true;     // set false if raw_snapshots_expand already fills clan_history (see note below)
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const sbGet = async p => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const sbPost = async (p, rows, prefer) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: prefer }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// read both camelCase and snake_case so it works with either payload style
const view = c => ({
  id: String(c.clanId ?? c.clan_id ?? c.id),
  name: c.name ?? null,
  tag: c.tag ?? c.clanTag ?? c.clan_tag ?? null,
  color: c.color ?? c.clanColor ?? c.clan_color ?? null,
  members: c.memberCount ?? c.member_count ?? c.members ?? null,
  cap: c.memberCap ?? c.member_cap ?? c.maxMembers ?? null,
  open: c.openJoin ?? c.open_join ?? null,
  kills: c.kills ?? null,
  rank: c.rank ?? null,
});
const toMap = payload => { const l = extractList(payload, 'clanId'); return l ? new Map(l.map(view).map(c => [c.id, c])) : null; };

function diff(a, b, na, nb) {
  const out = [];
  for (const [id, n] of nb) {
    const o = na.get(id); if (!o) continue;                 // only clans present in both snapshots
    const base = { clan_id: id, observed_at: b.fetched_at, since_at: a.fetched_at, name: n.name, tag: n.tag, snapshot_id: b.id, run_id: b.run_id ?? null };
    const add = (kind, oldV, newV, delta = null) => out.push({ ...base, kind, old_value: oldV, new_value: newV, delta,
      search_text: [n.name, n.tag, o.name, o.tag].filter(Boolean).join(' ').toLowerCase(), _n: n });
    if (o.members != null && n.members != null && n.members !== o.members)
      add(n.members < o.members ? 'left' : 'joined', { members: o.members }, { members: n.members }, Math.abs(n.members - o.members));
    if ((o.name != null && n.name != null && o.name !== n.name) || (o.tag != null && n.tag != null && o.tag !== n.tag))
      add('renamed', { name: o.name, tag: o.tag }, { name: n.name, tag: n.tag });
    if (o.open != null && n.open != null && o.open !== n.open) add('access', { open: o.open }, { open: n.open });
    if (o.color != null && n.color != null && o.color !== n.color) add('color', { color: o.color }, { color: n.color });
  }
  return out;
}

// pairs = how many consecutive snapshot pairs to look at (1 = just the latest; use more once to backfill)
export async function recordClanUpdates(pairs = 1) {
  const snaps = (await sbGet(`raw_snapshots?select=id,run_id,fetched_at,payload&source=eq.${SOURCE}&order=fetched_at.desc&limit=${pairs + 1}`)).reverse();
  let found = 0, saved = 0;
  for (let i = 1; i < snaps.length; i++) {
    const [a, b] = [snaps[i - 1], snaps[i]], na = toMap(a.payload), nb = toMap(b.payload);
    if (!na || !nb) continue;
    const rows = diff(a, b, na, nb); found += rows.length;
    if (!rows.length) continue;
    const kept = rows.map(({ _n, ...r }) => r);
    // ignore-duplicates: only rows that were really new come back, so clan_history never gets duplicates either
    const fresh = await sbPost('clan_updates?on_conflict=clan_id,kind,snapshot_id', kept, 'return=representation,resolution=ignore-duplicates');
    saved += fresh.length;
    if (WRITE_HISTORY && fresh.length) {
      const byKey = new Map(rows.map(r => [`${r.clan_id}|${r.kind}`, r._n]));
      await sbPost('clan_history', fresh.map(f => { const n = byKey.get(`${f.clan_id}|${f.kind}`) || {}; return {
        clan_id: f.clan_id, run_id: f.run_id, observed_at: f.observed_at, change_type: f.kind,
        changes: { from: f.old_value, to: f.new_value, delta: f.delta },
        name: n.name, tag: n.tag, color: n.color, member_count: n.members, member_cap: n.cap, open_join: n.open, kills: n.kills, rank: n.rank };
      }), 'return=minimal');
    }
  }
  return { snapshots: snaps.length, found, saved };
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
