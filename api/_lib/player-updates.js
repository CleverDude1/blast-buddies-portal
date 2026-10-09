// Diffs consecutive player snapshots -> player_updates (the feed the Player Updates page reads).
// player_history is already written by collect.js (syncEntities), so it is not touched here.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY
import { URLS, extractList } from './shared.js';

const MAX_LEVEL_XP = null;                    // <-- XP needed for level 100 (from js/level.js). null = level 100 events are skipped
const BOARDS = ['day', 'week', 'ranked'];
const CLAN_BOARDS = new Set(['day', 'ranked']);   // the weekly API sends no clanTag, so it can't tell us about clans
const WEAPON_BOARDS = new Set(['ranked']);        // day/week top weapons may be per-period and reset, so only ranked is compared

const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent;

const sbGet = async p => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const sbPost = async (p, rows) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(await r.text());
};

// payload shape: { data: { top: [ { name, totalXp, playerId, clanTag?, topWeaponId, ... } ] } }  (clanTag is absent when there is no clan)
const toMap = payload => {
  const list = payload?.data?.top ?? extractList(payload, 'playerId');
  if (!Array.isArray(list)) return null;
  return new Map(list.filter(p => p?.playerId).map(p => [String(p.playerId), {
    name: p.name ?? null, xp: p.totalXp ?? null, weapon: p.topWeaponId ?? null, clan: p.clanTag || null,
  }]));
};

// the last (pairs + 1) collection runs, oldest first: [{ at, run_id, boards: { day: Map, week: Map, ranked: Map } }]
async function loadRuns(pairs) {
  const byRun = new Map();
  await Promise.all(BOARDS.map(async bd => {
    const rows = await sbGet(`raw_snapshots?select=run_id,fetched_at,payload&url=eq.${enc(URLS[bd])}&order=fetched_at.desc&limit=${pairs + 1}`);
    for (const r of rows) {
      const k = r.run_id ?? r.fetched_at;
      const run = byRun.get(k) || { at: r.fetched_at, run_id: r.run_id ?? null, boards: {} };
      run.boards[bd] = toMap(r.payload); byRun.set(k, run);
    }
  }));
  return [...byRun.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-(pairs + 1));
}

function diff(a, b) {
  const found = new Map();                    // one row per player + kind, even if several boards report it
  for (const bd of BOARDS) {
    const A = a.boards[bd], B = b.boards[bd];
    if (!A || !B) continue;
    const add = (id, n, o, kind, oldV, newV) => {
      const key = `${id}|${kind}`, clan = CLAN_BOARDS.has(bd) ? n.clan : null;
      if (found.has(key) && (found.get(key).clan_tag || !clan)) return;
      found.set(key, { player_id: id, kind, observed_at: b.at, since_at: a.at, name: n.name, clan_tag: clan, old_value: oldV, new_value: newV,
        search_text: [n.name, o.name, n.clan, o.clan].filter(Boolean).join(' ').toLowerCase(), run_id: b.run_id });
    };
    const clanMoves = [];
    for (const [id, n] of B) {
      const o = A.get(id); if (!o) continue;     // only players present in both snapshots
      if (o.name && n.name && o.name !== n.name) add(id, n, o, 'renamed', { name: o.name }, { name: n.name });
      if (WEAPON_BOARDS.has(bd) && o.weapon != null && n.weapon != null && o.weapon !== n.weapon) add(id, n, o, 'weapon', { weaponId: o.weapon }, { weaponId: n.weapon });
      if (MAX_LEVEL_XP != null && o.xp != null && n.xp != null && o.xp < MAX_LEVEL_XP && n.xp >= MAX_LEVEL_XP) add(id, n, o, 'level_max', { xp: o.xp }, { xp: n.xp, level: 100 });
      if (CLAN_BOARDS.has(bd) && o.clan !== n.clan) clanMoves.push([id, n, o]);
    }
    // safety: if lots of clan members "lose" their clan at once the API probably glitched, so skip the clan changes for this board
    const hadClan = [...A.values()].filter(p => p.clan).length, lost = clanMoves.filter(([, n, o]) => o.clan && !n.clan).length;
    if (lost >= 5 && lost > hadClan * 0.3) continue;
    for (const [id, n, o] of clanMoves) {
      if (o.clan) add(id, n, o, 'clan_left', { tag: o.clan }, { tag: null });
      if (n.clan) add(id, n, o, 'clan_joined', { tag: o.clan }, { tag: n.clan });
    }
  }
  return [...found.values()];
}

// pairs = how many consecutive snapshot pairs to check (1 = latest only; use more once to backfill)
export async function recordPlayerUpdates(pairs = 1) {
  const runs = await loadRuns(pairs);
  let found = 0;
  for (let i = 1; i < runs.length; i++) {
    const rows = diff(runs[i - 1], runs[i]); found += rows.length;
    if (rows.length) await sbPost('player_updates?on_conflict=player_id,kind,observed_at', rows);   // re-runs are harmless
  }
  return { runs: runs.length, found };
}

// feed for the page: ?kind=all|renamed|weapon|level_max|clan_joined|clan_left &q=search &offset=0
export async function playerUpdates(q) {
  const limit = 50, offset = Math.max(0, parseInt(q.offset) || 0);
  let p = `player_updates?select=id,player_id,kind,observed_at,since_at,name,clan_tag,old_value,new_value&order=observed_at.desc,id.desc&limit=${limit + 1}&offset=${offset}`;
  if (['renamed', 'weapon', 'level_max', 'clan_joined', 'clan_left'].includes(q.kind)) p += `&kind=eq.${q.kind}`;
  const s = String(q.q || '').toLowerCase().replace(/[^\p{L}\p{N} _~-]/gu, '').trim();
  if (s) p += `&search_text=ilike.*${enc(s)}*`;
  const rows = await sbGet(p);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
