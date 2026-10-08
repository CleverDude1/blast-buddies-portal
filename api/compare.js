// Read-only endpoint for the Compare page.
//   /api/compare?mode=options&type=player|clan        -> who can be compared
//   /api/compare?mode=compare&type=...&a=ID&b=ID      -> current values + ranks + averages
//   /api/compare?mode=series&type=...&a=ID&b=ID       -> history rows for the graphs
//
// CURRENT VALUES come straight from the live APIs (the same ones the leaderboard pages use).
// Only if a player/clan is NOT in the live list do we fall back to the newest stored JSON snapshot (raw_snapshots).
// Averages and graphs come from Supabase history. Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { DAY, ID_RE, RANKED_SEASON, URLS, rest, inList, since, fetchLive, extractList, normPlayer, normClan } from './_lib/shared.js';

// day/week boards are stored with season 0, ranked with the current season number (used by averages + history)
const BOARD_FILTER = `or=${encodeURIComponent(`(and(board.in.(day,week),season.eq.0),and(board.eq.ranked,season.eq.${RANKED_SEASON}))`)}`;

async function liveBoards() {
  const boards = {};
  await Promise.all(['day', 'week', 'ranked'].map(async b => {
    try {
      const list = extractList(await fetchLive(URLS[b]), 'playerId');
      if (!list) throw new Error('no player list in response');
      boards[b] = list.map(normPlayer);
    } catch (e) { console.error(`live ${b} failed:`, e.message); boards[b] = []; }
  }));
  return boards;
}
async function liveClans() {
  try {
    const list = extractList(await fetchLive(URLS.clan), 'clanId');
    if (!list) throw new Error('no clan list in response');
    return list.map(normClan);
  } catch (e) { console.error('live clans failed:', e.message); return []; }
}

// ---------- fallback: newest stored JSON snapshots (raw_snapshots) ----------
// Scans recent stored responses (newest first) for the ids we could not find live.
async function rawFind(url, idKey, ids) {
  const found = {}, want = new Set(ids);
  for (let off = 0; off < 40 && want.size; off += 5) {
    let rows;
    try { rows = await rest(`raw_snapshots?select=fetched_at,payload&url=eq.${encodeURIComponent(url)}&order=fetched_at.desc&limit=5&offset=${off}`); }
    catch (e) { console.error('raw fallback failed:', e.message); break; }
    for (const r of rows) {
      for (const e of extractList(r.payload, idKey) || []) {
        if (want.has(e[idKey])) { found[e[idKey]] = { entry: e, at: r.fetched_at }; want.delete(e[idKey]); }
      }
    }
    if (rows.length < 5) break;
  }
  return found;
}

// ---------- who can be compared ----------
async function playerOptions() {
  const boards = await liveBoards(), m = new Map();
  for (const [b, rows] of Object.entries(boards)) for (const r of rows) {
    if (!ID_RE.test(r.player_id || '')) continue;
    const o = m.get(r.player_id) || { id: r.player_id, name: r.name || r.player_id, tag: r.clan_tag || '', boards: [] };
    o.boards.push(b); m.set(r.player_id, o);
  }
  if (m.size) return [...m.values()].sort((x, y) => x.name.localeCompare(y.name));
  return playerOptionsDb();                                 // live APIs down: use what was stored
}
async function playerOptionsDb() {
  const rows = await rest(`leaderboard_state?select=player_id,board&${BOARD_FILTER}`, { all: true, max: 5000 });
  const boards = new Map();
  for (const r of rows) { if (!boards.has(r.player_id)) boards.set(r.player_id, new Set()); boards.get(r.player_id).add(r.board); }
  const ids = [...boards.keys()].filter(i => ID_RE.test(i)), names = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = await rest(`players?select=player_id,name,clan_tag&player_id=${inList(ids.slice(i, i + 100))}`);
    chunk.forEach(p => names.set(p.player_id, p));
  }
  return ids.map(id => ({ id, name: names.get(id)?.name || id, tag: names.get(id)?.clan_tag || '', boards: [...boards.get(id)] }))
    .sort((x, y) => x.name.localeCompare(y.name));
}
async function clanOptions() {   // same top 50 (by kills) as the Clan Rankings page
  const live = (await liveClans()).filter(c => ID_RE.test(c.clan_id || '')).sort((x, y) => (y.kills ?? -1) - (x.kills ?? -1)).slice(0, 50);
  if (live.length) return live.map(c => ({ id: c.clan_id, name: c.name || c.clan_id, tag: c.tag || '', kills: c.kills }));
  const rows = await rest(`clans?select=clan_id,name,tag,kills&order=kills.desc.nullslast&limit=50`);
  return rows.map(c => ({ id: c.clan_id, name: c.name || c.clan_id, tag: c.tag || '', kills: c.kills }));
}

// ---------- current values + averages ----------
async function comparePlayers(a, b) {
  const pair = inList([a, b]);
  const boards = await liveBoards(), fallback = {};
  await Promise.all(['day', 'week', 'ranked'].map(async key => {
    fallback[key] = {};
    const missing = [a, b].filter(id => !boards[key].some(r => r.player_id === id));
    if (!missing.length) return;
    const found = await rawFind(URLS[key], 'playerId', missing);       // not live -> newest stored JSON
    for (const id of missing) if (found[id]) fallback[key][id === a ? 'a' : 'b'] = { ...normPlayer(found[id].entry, null), _at: found[id].at };
  }));
  const [averages, dbInfo] = await Promise.all([
    rest(`player_board_averages?player_id=${pair}&${BOARD_FILTER}`).catch(e => { console.error('averages failed:', e.message); return []; }),
    rest(`players?select=player_id,name,clan_tag,clan_color&player_id=${pair}`).catch(() => []),
  ]);
  const all = [...Object.values(boards).flat(), ...Object.values(fallback).flatMap(f => Object.values(f))];
  const who = id => {
    const hit = all.find(r => r.player_id === id), p = dbInfo.find(x => x.player_id === id);
    return { id, name: hit?.name || p?.name || id, tag: hit?.clan_tag ?? p?.clan_tag ?? '', color: hit?.clan_color ?? p?.clan_color ?? null };
  };
  return { type: 'player', season: RANKED_SEASON, info: { a: who(a), b: who(b) }, boards, fallback, averages };
}
async function compareClans(a, b) {
  const pair = inList([a, b]);
  const pop = await liveClans(), fallback = {};
  const missing = [a, b].filter(id => !pop.some(c => c.clan_id === id));
  if (missing.length) {
    const found = await rawFind(URLS.clan, 'clanId', missing);
    for (const id of missing) if (found[id]) fallback[id === a ? 'a' : 'b'] = { ...normClan(found[id].entry), _at: found[id].at };
  }
  const averages = await rest(`clan_board_averages?clan_id=${pair}`).catch(e => { console.error('averages failed:', e.message); return []; });
  const all = [...pop, ...Object.values(fallback)];
  const who = id => { const c = all.find(x => x.clan_id === id); return { id, name: c?.name || id, tag: c?.tag || '' }; };
  return { type: 'clan', info: { a: who(a), b: who(b) }, pop, fallback, averages };
}

// ---------- history for the graphs ----------
// Reads EVERY hourly snapshot from entry_snapshots (filled by supabase/hourly-snapshots.sql).
// If a board has no snapshots yet, falls back to the change-only history tables.
const snapRows = async (kind, season, id, days, cols, max) =>
  (await rest(`entry_snapshots?select=taken_at,${cols}&kind=eq.${kind}&season=eq.${season}&entity_id=eq.${id}&taken_at=gte.${since(days)}&order=taken_at.desc`,
    { all: true, max })).reverse().map(({ taken_at, ...r }) => ({ observed_at: taken_at, ...r }));   // oldest -> newest

async function playerRows(board, season, days, id) {
  const rows = await snapRows(board, season, id, days, 'kills,deaths,trophies,ranked_wins,ranked_losses', 6000);
  if (rows.length) return rows;
  return rest(`leaderboard_history?select=observed_at,kills,deaths,trophies,ranked_wins,ranked_losses&player_id=eq.${id}&board=eq.${board}&season=eq.${season}&observed_at=gte.${since(days)}&order=observed_at.desc`, { all: true, max: 6000 })
    .then(r => r.reverse());
}
async function clanRows(days, id) {
  const rows = await snapRows('clan', 0, id, days, 'kills,member_count', 9000);
  if (rows.length) return rows;
  return rest(`clan_history?select=observed_at,kills,member_count&clan_id=eq.${id}&observed_at=gte.${since(days)}&order=observed_at.desc`, { all: true, max: 9000 })
    .then(r => r.reverse());
}

async function seriesPlayers(a, b) {
  const plan = { day: ['day', 0, 40], week: ['week', 0, 100], ranked: ['ranked', RANKED_SEASON, 120] };   // [board, season, days back]
  const out = {};
  await Promise.all(Object.entries(plan).map(async ([key, [board, season, days]]) => {
    const [ra, rb] = await Promise.all([a, b].map(id => playerRows(board, season, days, id)));
    out[key] = { a: ra, b: rb };
  }));
  return out;
}
async function seriesClans(a, b) {
  const [ra, rb] = await Promise.all([a, b].map(id => clanRows(365, id)));
  return { clan: { a: ra, b: rb } };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { mode, type, a, b } = req.query;
    if (!['player', 'clan'].includes(type)) return res.status(400).json({ error: 'type must be player or clan' });
    let data;
    if (mode === 'options') data = type === 'player' ? await playerOptions() : await clanOptions();
    else if (mode === 'compare' || mode === 'series') {
      if (!ID_RE.test(a || '') || !ID_RE.test(b || '')) return res.status(400).json({ error: 'a and b must be valid ids' });
      data = mode === 'compare'
        ? (type === 'player' ? await comparePlayers(a, b) : await compareClans(a, b))
        : (type === 'player' ? await seriesPlayers(a, b) : await seriesClans(a, b));
    } else return res.status(400).json({ error: 'unknown mode' });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');   // protects the database
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
