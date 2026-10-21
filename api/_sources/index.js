// Folders/files starting with "_" inside /api are NOT exposed as routes by Vercel,
// so this list stays private.
//
// SOURCES = what we actually fetch (one combined API).
// BOARDS  = the boards cut out of that response. Keys and urls match the retired
//           APIs on purpose, so old raw_snapshots, hourAgo(url) lookups and the
//           clan-updates diff (source = 'clan') keep working. Nothing here is fetched.
//
// type: 'leaderboard' -> rows with playerId (players + leaderboard tables)
// type: 'clans'       -> rows with clanId   (clans tables)

const BASE = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';

export const SOURCES = [
  { key: 'pangolin', type: 'bundle', url: `${BASE}/api/pangolin-test` },
];

export const BOARDS = [
  { key: 'leaderboard-day',    type: 'leaderboard', board: 'day',    season: 0, url: `${BASE}/api/leaderboard-day`,    pick: (p) => p.leaderboards?.daily?.top },
  { key: 'leaderboard-week',   type: 'leaderboard', board: 'week',   season: 0, url: `${BASE}/api/leaderboard-week`,   pick: (p) => p.leaderboards?.weekly?.top },
  { key: 'leaderboard-ranked', type: 'leaderboard', board: 'ranked', season: 3, url: `${BASE}/api/leaderboard-ranked`, pick: (p) => p.ranked?.current?.top },
  { key: 'clan',               type: 'clans',       board: 'clan',                url: `${BASE}/api/clan`,               pick: (p) => p.clans?.top },
];
