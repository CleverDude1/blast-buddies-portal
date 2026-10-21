const BASE = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';

// The only thing we fetch now.
export const SOURCES = [
  { key: 'pangolin', type: 'bundle', url: `${BASE}/api/pangolin-test` },
];

// Boards cut out of the bundle. Keys and urls match the retired APIs, so old raw_snapshots,
// hourAgo(url) lookups and the clan-updates diff keep working.
export const BOARDS = [
  { key: 'leaderboard-day',    type: 'leaderboard', board: 'day',    season: 0, url: `${BASE}/api/leaderboard-day`,    pick: (p) => p.leaderboards?.daily?.top },
  { key: 'leaderboard-week',   type: 'leaderboard', board: 'week',   season: 0, url: `${BASE}/api/leaderboard-week`,   pick: (p) => p.leaderboards?.weekly?.top },
  { key: 'leaderboard-ranked', type: 'leaderboard', board: 'ranked', season: 3, url: `${BASE}/api/leaderboard-ranked`, pick: (p) => p.ranked?.current?.top },
  { key: 'clan',               type: 'clans',       board: 'clan',                url: `${BASE}/api/clan`,               pick: (p) => p.clans?.top },
];
