const BASE = process.env.API_BASE_URL || 'https://blast-buddies-portal.vercel.app';

export const SOURCES = [
  { key: 'pangolin', type: 'bundle', url: `${BASE}/api/pangolin-test` },
];
