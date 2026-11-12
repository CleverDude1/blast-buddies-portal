// Data for the home page dashboard ("Who are you in the game?"). Read-only.
//   /api/hourly?mode=me&q=NAME  -> up to 10 players whose name contains NAME
//   /api/hourly?mode=me&id=ID   -> everything the dashboard shows for that player
// Reads: players, monthly_player_kills, perf_records, and the newest stored snapshot of the daily, weekly and clan boards.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { extractList } from './shared.js';
import { BOARDS as PERF } from './performance.js';

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), KEY = process.env.SUPABASE_SECRET_KEY;
const enc = encodeURIComponent;
const KDR_MIN_KILLS = 1000;   // same cutoff as the Best lifetime KDR board

// count = true also returns the total number of matching rows (only one row is transferred)
async function q(path, count = false) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(count ? { Prefer: 'count=exact', Range: '0-0' } : {}) },
  });
  if (r.status === 416) return { rows: [], total: 0 };
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const rows = await r.json();
  const total = count ? Number((r.headers.get('content-range') || '').split('/')[1]) : NaN;
  return { rows, total: Number.isFinite(total) ? total : null };
}

// ---------- name search ----------
export async function meSearch(raw) {
  const s = String(raw ?? '').replace(/[*,()%\\"'<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (s.length < 2) return { results: [] };
  const { rows } = await q(`players?select=player_id,name,clan_tag,level,kills&name=ilike.${enc('*' + s + '*')}&order=kills.desc.nullslast&limit=10`);
  const exact = s.toLowerCase();
  const results = rows.map(r => ({ id: r.player_id, name: r.name, tag: r.clan_tag || '', level: r.level ?? null, kills: r.kills == null ? null : Number(r.kills) }))
    .sort((a, b) => (b.name?.toLowerCase() === exact) - (a.name?.toLowerCase() === exact));
  return { results };
}

// ---------- helpers ----------
// newest stored snapshot of a board ("now" for the whole site; this file never calls the game API)
async function latest(source) {
  const { rows: [row] } = await q(`raw_snapshots?select=fetched_at,payload&source=eq.${enc(source)}&order=fetched_at.desc&limit=1`);
  if (!row) return null;
  return { at: row.fetched_at, list: extractList(row.payload, source === 'clan' ? 'clanId' : 'playerId') || [] };
}

function boardInfo(snap, id, metric = 'kills') {
  if (!snap || !snap.list.length) return null;
  const L = snap.list, vals = L.map(p => Number(p[metric]) || 0), top = Math.max(...vals), i = L.findIndex(p => p.playerId === id);
  return { at: snap.at, size: L.length, top, topName: L[vals.indexOf(top)].name, cutoff: Math.min(...vals),
    on: i >= 0, rank: i >= 0 ? (L[i].rank ?? i + 1) : null, value: i >= 0 ? vals[i] : null };
}

function clanInfo(list, clanId) {
  const L = [...list].sort((a, b) => (Number(b.kills) || 0) - (Number(a.kills) || 0));
  const i = L.findIndex(c => String(c.clanId) === String(clanId));
  if (i < 0) return null;
  const c = L[i];
  return { id: String(c.clanId), name: c.name, tag: c.tag, color: c.color ?? null, kills: Number(c.kills) || 0, rank: i + 1, of: L.length,
    top: Number(L[0].kills) || 0, topName: L[0].name, members: c.memberCount ?? null, cap: c.memberCap ?? null, openJoin: c.openJoin ?? null };
}

// "2026-11" (or similar) -> { label: 'November 2026', current: true/false }
function periodInfo(p) {
  const m = /(\d{4})\D*(\d{1,2})/.exec(String(p)), now = new Date();
  if (!m) return { label: String(p), current: false };
  const y = +m[1], mo = +m[2];
  return { label: new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    current: y === now.getUTCFullYear() && mo === now.getUTCMonth() + 1 };
}

// members of the clan with their kills in the newest month stored for that clan (top 20 clans only)
async function clanMembers(cid, myId) {
  const last = (await q(`monthly_player_kills?select=period&clan_id=eq.${enc(cid)}&order=period.desc&limit=1`)).rows[0];
  if (!last) return null;
  const { rows } = await q(`monthly_player_kills?select=player_id,name,kills,is_leader&clan_id=eq.${enc(cid)}&period=eq.${enc(last.period)}&order=kills.desc&limit=60`);
  const i = rows.findIndex(r => r.player_id === myId), per = periodInfo(last.period);
  return { label: per.label, current: per.current, count: rows.length, place: i >= 0 ? i + 1 : null,
    leader: rows.find(r => r.is_leader)?.name || null,
    top: rows.slice(0, 5).map(r => ({ id: r.player_id, name: r.name, kills: Number(r.kills) })),
    me: i >= 5 ? { name: rows[i].name, kills: Number(rows[i].kills) } : null };
}

// ---------- Player Performance ranks ----------
// The six record boards live in perf_records (one row per player/clan = personal best).
async function recordRank(board, entityId, title) {
  const meta = PERF[board];
  const [mine, top] = await Promise.all([
    q(`perf_records?select=value,achieved_at&board=eq.${board}&entity_id=eq.${enc(entityId)}&limit=1`),
    q(`perf_records?select=name,value&board=eq.${board}&order=value.desc&limit=1`, true),
  ]);
  const t = top.rows[0];
  if (!t) return null;
  const out = { id: board, title: title || meta.title, unit: meta.unit, total: top.total, top: Number(t.value), topName: t.name, value: null };
  const m = mine.rows[0];
  if (m) {
    const g = await q(`perf_records?select=entity_id&board=eq.${board}&value=gt.${m.value}`, true);
    out.value = Number(m.value); out.rank = (g.total ?? 0) + 1;
  }
  return out;
}

async function kdrRank(p) {
  const base = `players?kdr=not.is.null&kills=gte.${KDR_MIN_KILLS}`;
  const top = await q(`${base}&select=name,kdr&order=kdr.desc&limit=1`, true), t = top.rows[0];
  if (!t) return null;
  const out = { id: 'lifetime_kdr', title: PERF.lifetime_kdr.title, unit: PERF.lifetime_kdr.unit, total: top.total, top: Number(t.kdr), topName: t.name, value: null };
  if (p.kdr != null && Number(p.kills) >= KDR_MIN_KILLS) {
    const g = await q(`${base}&select=player_id&kdr=gt.${p.kdr}`, true);
    out.value = Number(p.kdr); out.rank = (g.total ?? 0) + 1;
  }
  return out;
}

// best month per player (same rule as the Player Performance page); the rank counts different players with a bigger best month
async function monthRank(id) {
  const [mine, top] = await Promise.all([
    q(`monthly_player_kills?select=period,kills&player_id=eq.${enc(id)}&order=kills.desc&limit=1`),
    q(`monthly_player_kills?select=name,kills&order=kills.desc&limit=1`),
  ]);
  const t = top.rows[0];
  if (!t) return null;
  const out = { id: 'month_kills', title: PERF.month_kills.title, unit: PERF.month_kills.unit, total: null, top: Number(t.kills), topName: t.name, value: null };
  const m = mine.rows[0];
  if (m) {
    const g = await q(`monthly_player_kills?select=player_id&kills=gt.${m.kills}&limit=1000`);
    out.value = Number(m.kills); out.rank = new Set(g.rows.map(r => r.player_id)).size + 1; out.rankApprox = g.rows.length >= 1000;
  }
  return out;
}

async function performance(p, cid) {
  const id = String(p.player_id);
  const jobs = Object.keys(PERF).map(b =>
    b === 'lifetime_kdr' ? kdrRank(p)
    : b === 'month_kills' ? monthRank(id)
    : b === 'gain_clan' ? (cid ? recordRank(b, cid, 'Your clan: biggest 1-hour gain') : null)
    : recordRank(b, id));
  return (await Promise.allSettled(jobs)).map(r => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
}

// ---------- the dashboard ----------
export async function meRead(rawId) {
  const id = String(rawId || '');
  if (!/^[\w-]{3,40}$/.test(id)) return { found: false };
  const p = (await q(`players?select=*&player_id=eq.${enc(id)}`)).rows[0];
  if (!p) return { found: false };

  const errors = {};
  const safe = async (name, fn) => {
    try { return await fn(); } catch (e) { errors[name] = e.message; console.error(`me ${name} failed:`, e.message); return null; }
  };
  const wantClan = !!(p.clan_id || p.clan_tag);
  const [day, week, clanBoard, own] = await Promise.all([
    safe('day', () => latest('leaderboard-day')),
    safe('week', () => latest('leaderboard-week')),
    wantClan ? safe('clanBoard', () => latest('clan')) : null,
    safe('months', () => q(`monthly_player_kills?select=period,kills&player_id=eq.${enc(id)}&order=period.desc&limit=12`)),
  ]);

  // the player's clan: by clan_id, else by tag when the tag is unique on the clan board, else the stored clans row
  let cid = p.clan_id ? String(p.clan_id) : null, clan = null;
  if (clanBoard) {
    clan = cid ? clanInfo(clanBoard.list, cid) : null;
    if (!clan && p.clan_tag) {
      const same = clanBoard.list.filter(c => c.tag === p.clan_tag);
      if (same.length === 1) { cid = String(same[0].clanId); clan = clanInfo(clanBoard.list, cid); }
    }
  }
  if (!clan && cid) {
    clan = await safe('clanRow', async () => {
      const r = (await q(`clans?select=name,tag,color,member_count,member_cap,kills&clan_id=eq.${enc(cid)}`)).rows[0];
      return r && { id: cid, name: r.name, tag: r.tag, color: r.color, kills: Number(r.kills) || 0, rank: null, of: null, top: null, topName: null,
        members: r.member_count, cap: r.member_cap, stale: true };
    });
  }

  const [members, perf] = await Promise.all([
    cid ? safe('members', () => clanMembers(cid, id)) : null,
    safe('performance', () => performance(p, cid)),
  ]);

  const months = (own?.rows || []).map(r => ({ ...periodInfo(r.period), kills: Number(r.kills) })).reverse();   // oldest first
  return {
    found: true, generatedAt: new Date().toISOString(),
    player: { id, name: p.name, tag: p.clan_tag || '', level: p.level ?? null, kills: p.kills == null ? null : Number(p.kills),
      deaths: p.deaths == null ? null : Number(p.deaths), kdr: p.kdr == null ? null : Number(p.kdr), games: p.games == null ? null : Number(p.games) },
    today: boardInfo(day, id), week: boardInfo(week, id),
    months, clan, members, performance: perf || [], errors,
  };
}
