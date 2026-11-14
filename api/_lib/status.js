// API health for the "New API" / "Old API" buttons in the top bar.
//   /api/hourly?mode=status  ->  { generatedAt, new: {...}, old: {...} }
//
// "New API" = the combined Pangolin API that api/collect.js fetches once an hour. This file NEVER calls it (it only allows 1 request per
// 5 minutes per IP); it reads what the collector wrote to collection_runs (status ok | partial | failed, plus an errors list).
//   - failed  = the fetch failed or the upstream snapshot was stale (collect.js: no successful fetch)  -> red
//   - partial = the fetch worked but something after it errored                                         -> amber
//   - the newest run never finished (timed out / crashed), or no good run for 2.5 hours                -> red; a good run 75+ min old -> amber
//
// "Old API" = the game's own per-board servers that api/collect.js falls back to when the new API does not deliver a board.
// It is checked LIVE here (a short request to each board, remembered for 2 minutes so visitors do not each hit the game servers):
//   - ok   = weekly, ranked and clans all answer with real rows
//   - warn = only some of them answer
//   - down = none answer
// The top bar script (js/api-status.js) turns this into the button colours: yellow standby while the new API works, green when the
// old API has taken over, red when both are down. The daily board is checked but not counted (its old address is unconfirmed).
// "lastRunAt" for the old API = the last collection that actually used the old API as a backup.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, RANKED_SEASON (optional, default 3)
import { rest, extractList } from './shared.js';

const MIN = 60e3;
const OK_MIN = 75;        // the collector runs at minute 55 every hour: a good run up to 75 minutes old is normal
const DOWN_MIN = 150;     // no good run for this long = red
const CRASH_MIN = 15;     // a run that started this long ago and never finished crashed or timed out
const FINISHED = new Set(['ok', 'partial', 'failed']);
const LEVEL = { ok: 0, warn: 1, down: 2 };

const iso = ms => (ms == null ? null : new Date(ms).toISOString());
const text = v => String(v ?? '').slice(0, 220);

async function newApi() {
  const now = Date.now();
  const rows = await rest('collection_runs?select=id,started_at,finished_at,status,errors&order=started_at.desc&limit=12');
  const runs = rows.map(r => ({
    startedAt: Date.parse(r.started_at),
    finishedAt: r.finished_at ? Date.parse(r.finished_at) : null,
    status: FINISHED.has(r.status) ? r.status : null,                 // null = still running or never finished
    errors: Array.isArray(r.errors) ? r.errors : [],
  }));
  const finished = runs.filter(r => r.status), last = finished[0] || null;
  const lastGood = finished.find(r => r.status === 'ok' || r.status === 'partial') || null;
  const at = r => (r ? (r.finishedAt ?? r.startedAt) : null);

  let state = 'ok', reason = 'The last hourly collection finished without errors.';
  const bump = (s, why) => { if (LEVEL[s] > LEVEL[state]) { state = s; reason = why; } };

  if (!last) {
    bump('warn', 'No collection run has finished yet.');
  } else {
    const sinceGood = lastGood ? (now - at(lastGood)) / MIN : Infinity;
    if (last.status === 'failed') bump('down', 'The last collection failed: the API could not be fetched or its snapshot was stale.');
    if (sinceGood > DOWN_MIN) bump('down', lastGood ? `No successful collection for ${Math.round(sinceGood / 60 * 10) / 10} hours.` : 'There has been no successful collection yet.');
    else if (sinceGood > OK_MIN) bump('warn', `The last successful collection is ${Math.round(sinceGood)} minutes old (it normally runs every 60).`);
    // errors with a "source" (and no "step") come from fetching the API itself: unreachable, stale, or boards missing from the answer
    // (notes the collector marked "recovered" were fixed by the old-API fallback, so they no longer count against the new API's own check)
    const apiErrs = last.errors.filter(e => e.source && !e.step);
    const empty = apiErrs.filter(e => /board missing|empty/i.test(String(e.error ?? e.message)));
    if (empty.length >= 3) bump('down', 'The API answered, but most of its boards were empty.');
    else if (apiErrs.length && last.status !== 'failed') bump('warn', 'The API answered, but some of its boards were missing or stale.');
    if (last.status === 'partial') bump('warn', 'The API answered, but some part of the collection reported errors.');
    // a run that started long ago and never finished timed out or crashed: usually the API hanging, so this counts as down
    const newest = runs[0];
    if (newest && !newest.status && (now - newest.startedAt) / MIN > CRASH_MIN) bump('down', 'The newest collection run never finished: it crashed or timed out, usually because the API did not answer.');
  }

  return {
    state,
    title: state === 'ok' ? 'Working' : state === 'warn' ? 'Working with problems' : 'Not working',
    reason,
    lastRunAt: iso(at(last)), lastRunStatus: last?.status ?? null,
    lastGoodAt: iso(at(lastGood)),
    errors: (last?.errors || []).slice(0, 4).map(e => ({ where: e.step || e.source || 'run', message: text(e.error ?? e.message) })),
  };
}

// ---------- Old API: live check of the game's per-board servers ----------
const OLD_CHECKS = [
  { name: 'Weekly', url: 'https://eu1-ping.blastbuddies.io/api/leaderboard/week',  idKey: 'playerId', counts: true },
  { name: 'Ranked', url: 'https://na1-ping.blastbuddies.io/api/leaderboard/ranked?season=' + encodeURIComponent(process.env.RANKED_SEASON || 3), idKey: 'playerId', counts: true },
  { name: 'Clans',  url: 'https://eu1-ping.blastbuddies.io/api/leaderboard/clans', idKey: 'clanId',   counts: true },
  { name: 'Daily',  url: 'https://eu1-ping.blastbuddies.io/api/leaderboard/day',   idKey: 'playerId', counts: false },
];
const OLD_TTL = 2 * MIN;
let oldCache = null;

async function probe(c) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(c.url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = extractList(await r.json(), c.idKey);
    if (!Array.isArray(list) || !list.length) throw new Error('answered, but with no rows');
    return null;
  } catch (e) { return e.name === 'AbortError' ? 'no answer within 6 seconds' : String(e.message || e); }
  finally { clearTimeout(timer); }
}

// when did a collection last use the old API as its backup? (collect.js writes summary.sources.fallback)
async function lastFallbackAt() {
  try {
    const rows = await rest('collection_runs?select=started_at,finished_at,status,summary&order=started_at.desc&limit=48');
    const r = rows.find(x => FINISHED.has(x.status) && Array.isArray(x.summary?.sources?.fallback) && x.summary.sources.fallback.length);
    return r ? Date.parse(r.finished_at || r.started_at) : null;
  } catch (e) { return null; }
}

async function oldApi() {
  if (oldCache && Date.now() - oldCache.t < OLD_TTL) return oldCache.v;
  const [results, usedAt] = await Promise.all([
    Promise.all(OLD_CHECKS.map(async c => ({ c, err: await probe(c) }))),
    lastFallbackAt(),
  ]);
  const counted = results.filter(x => x.c.counts), good = counted.filter(x => !x.err).length;
  const state = good === counted.length ? 'ok' : good > 0 ? 'warn' : 'down';
  const v = {
    state,
    title: state === 'ok' ? 'Working' : state === 'warn' ? 'Working with problems' : 'Not working',
    reason: state === 'ok' ? 'The old per-board APIs (weekly, ranked, clans) are all answering.'
      : state === 'warn' ? `Only ${good} of ${counted.length} old boards are answering.` : 'None of the old per-board APIs are answering.',
    lastRunAt: iso(usedAt), lastRunStatus: null, lastGoodAt: null,       // lastRunAt = last time a collection used the old API as its backup
    errors: results.filter(x => x.err).slice(0, 4).map(x => ({ where: x.c.name + (x.c.counts ? '' : ' (not counted)'), message: text(x.err) })),
  };
  oldCache = { t: Date.now(), v };
  return v;
}

export async function apiStatus() {
  const [n, o] = await Promise.allSettled([newApi(), oldApi()]);
  const unknown = e => ({ state: 'unknown', title: 'Status unavailable', reason: text(e?.message || 'The status check failed.'), lastRunAt: null, lastRunStatus: null, lastGoodAt: null, errors: [] });
  return { generatedAt: new Date().toISOString(), new: n.status === 'fulfilled' ? n.value : unknown(n.reason), old: o.status === 'fulfilled' ? o.value : unknown(o.reason) };
}
