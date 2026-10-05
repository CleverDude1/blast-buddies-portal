// Folders/files starting with "_" inside /api are NOT exposed as routes by Vercel,
// so this list stays private. To track a new API, add one line here.
//
// type: 'leaderboard' -> rows with playerId (players + leaderboard tables)
// type: 'clans'       -> rows with clanId   (clans tables)

const BASE = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';
const RANKED_SEASON = Number(process.env.RANKED_SEASON || 3); // bump when a new season starts

export const SOURCES = [
  { key: 'leaderboard-day',    type: 'leaderboard', board: 'day',    season: 0,             url: `${BASE}/api/leaderboard-day` },
  { key: 'leaderboard-week',   type: 'leaderboard', board: 'week',   season: 0,             url: `${BASE}/api/leaderboard-week` },
  { key: 'leaderboard-ranked', type: 'leaderboard', board: 'ranked', season: RANKED_SEASON, url: `${BASE}/api/leaderboard-ranked?season=${RANKED_SEASON}` },
  { key: 'clan',               type: 'clans',                                               url: `${BASE}/api/clan` },
];
