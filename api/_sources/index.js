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
// The only thing the collector fetches (once an hour, server side). The API allows 1 successful request per 5 minutes per IP.
const PANGOLIN_URL = process.env.PANGOLIN_URL || 'https://api.pangolinworks.dev/blast-buddies';
// Only used as the label/URL of the ranked board in raw_snapshots and as a fallback season; the real season comes from the data.
export const RANKED_SEASON = Number(process.env.RANKED_SEASON || 3);

export const SOURCES = [
  { key: 'pangolin', type: 'bundle', url: PANGOLIN_URL },
];

// The urls below are NOT fetched. They are the names the old per-board APIs had, kept so api/_lib/shared.js (URLS), records.js
// (hourAgo, backfill) and the history already stored in raw_snapshots keep matching. The ranked url must include ?season=.
export const BOARDS = [
  { key: 'leaderboard-day',    type: 'leaderboard', board: 'day',    season: 0,              url: `${BASE}/api/leaderboard-day`,                              pick: (p) => p.leaderboards?.daily?.top },
  { key: 'leaderboard-week',   type: 'leaderboard', board: 'week',   season: 0,              url: `${BASE}/api/leaderboard-week`,                             pick: (p) => p.leaderboards?.weekly?.top },
  { key: 'leaderboard-ranked', type: 'leaderboard', board: 'ranked', season: RANKED_SEASON, url: `${BASE}/api/leaderboard-ranked?season=${RANKED_SEASON}`,  pick: (p) => p.ranked?.current?.top },
  { key: 'clan',               type: 'clans',       board: 'clan',                           url: `${BASE}/api/clan`,                                         pick: (p) => p.clans?.top },
];
