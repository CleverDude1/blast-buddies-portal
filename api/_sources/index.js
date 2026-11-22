export const PANGOLIN_URL = process.env.PANGOLIN_URL || 'https://api.pangolinworks.dev/blast-buddies';
const BACKUP_URL = process.env.BACKUP_API_URL || `${BASE}/api/board-new`;
export const RANKED_SEASON = Number(process.env.RANKED_SEASON || 3);

// Tried in this order; the collector stops at the first one that delivers every board.
export const SOURCES = [
  { key: 'pangolin',  type: 'bundle', url: process.env.MAIN_API_URL || PANGOLIN_URL },
  { key: 'board-new', type: 'bundle', url: BACKUP_URL },
];
