// Read-only endpoint for the Compare page. Reads Supabase with the SERVICE ROLE key (kept server-side, never in the browser).
//   /api/compare?mode=options&type=player|clan        -> who can be compared
//   /api/compare?mode=compare&type=...&a=ID&b=ID      -> current values, ranks, averages
//   /api/compare?mode=series&type=...&a=ID&b=ID       -> history rows for the graphs
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY (the sb_secret_... key), RANKED_SEASON (optional, default 3)
const RANKED_SEASON = Number(process.env.RANKED_SEASON || 3);   // change when a new ranked season starts
const DAY = 864e5;
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

// day/week boards are stored with season 0, ranked with the current season number
const BOARD_FILTER = `or=${encodeURIComponent(`(and(board.in.(day,week),season.eq.0),and(board.eq.ranked,season.eq.${RANKED_SEASON}))`)}`;
const STATE_COLS = 'board,player_id,rank,kills,deaths,trophies,ranked_wins,ranked_losses,last_seen_at';
const CLAN_COLS = 'clan_id,name,tag,color,member_count,member_cap,open_join,kills,last_seen_at';

// PostgREST helper. `all` pages through results (Supabase returns max 1000 rows per request).
async function rest(path, { all = false, max = 1000 } = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  // New sb_secret_ keys go in the apikey header only; old JWT-style keys (eyJ...) also go in Authorization.
  const auth = key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, ...auth, 'Range-Unit': 'items', Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    rows.push(...page);
    if (!all || page.length < 1000 || rows.length >= max) break;
  }
  return rows;
}
const inList = ids => `in.(${ids.join(',')})`;
const since = days => encodeURIComponent(new Date(Date.now() - days * DAY).toISOString());

// ---------- who can be compared ----------
async function playerOptions() {
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
async function clanOptions() {   // same 50 clans as the Clan Rankings page
  const rows = await rest(`clans?select=clan_id,name,tag,kills&order=kills.desc.nullslast&limit=50`);
  return rows.map(c => ({ id: c.clan_id, name: c.name || c.clan_id, tag: c.tag || '', kills: c.kills }));
}

// ---------- current values + averages ----------
async function comparePlayers(a, b) {
  const pair = inList([a, b]);
  const [pop, mine, avgs, info] = await Promise.all([
    rest(`leaderboard_state?select=${STATE_COLS}&${BOARD_FILTER}&order=rank.asc.nullslast`, { all: true, max: 3000 }),
    rest(`leaderboard_state?select=${STATE_COLS}&player_id=${pair}&${BOARD_FILTER}`),
    rest(`player_board_averages?player_id=${pair}&${BOARD_FILTER}`),
    rest(`players?select=player_id,name,clan_tag,clan_color&player_id=${pair}`),
  ]);
  const boards = { day: [], week: [], ranked: [] }, seen = new Set();
  for (const r of [...mine, ...pop]) {            // make sure both players are included even if the board is huge
    const k = `${r.board}|${r.player_id}`;
    if (!seen.has(k) && boards[r.board]) { seen.add(k); boards[r.board].push(r); }
  }
  const who = id => { const p = info.find(x => x.player_id === id); return { id, name: p?.name || id, tag: p?.clan_tag || '', color: p?.clan_color ?? null }; };
  return { type: 'player', season: RANKED_SEASON, info: { a: who(a), b: who(b) }, boards, averages: avgs };
}
async function compareClans(a, b) {
  const pair = inList([a, b]);
  const [pop, mine, avgs] = await Promise.all([
    rest(`clans?select=${CLAN_COLS}&order=kills.desc.nullslast&limit=50`),
    rest(`clans?select=${CLAN_COLS}&clan_id=${pair}`),
    rest(`clan_board_averages?clan_id=${pair}`),
  ]);
  const seen = new Set(), rows = [];
  for (const r of [...mine, ...pop]) if (!seen.has(r.clan_id)) { seen.add(r.clan_id); rows.push(r); }
  const who = id => { const c = rows.find(x => x.clan_id === id); return { id, name: c?.name || id, tag: c?.tag || '' }; };
  return { type: 'clan', info: { a: who(a), b: who(b) }, pop: rows, averages: avgs };
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
