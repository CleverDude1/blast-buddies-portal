// API health for the "New API" / "Old API" buttons in the top bar.
//   /api/hourly?mode=status  ->  { generatedAt, new: {...}, old: {...} }
//
// "New API" = the combined Pangolin API that api/collect.js fetches once an hour. This file NEVER calls it (it only allows 1 request per
// 5 minutes per IP); it reads what the collector wrote to collection_runs (status ok | partial | failed, plus an errors list).
//   - failed  = the fetch failed or the upstream snapshot was stale (collect.js: no successful fetch)  -> red
//   - partial = the fetch worked but something after it errored                                         -> amber
//   - the newest run never finished (timed out / crashed), or no good run for 2.5 hours                -> red; a good run 75+ min old -> amber
// "Old API" is not connected yet: it always reports state "off" (grey). Connect it in oldApi() below later.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY
import { rest } from './shared.js';

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

// Not connected yet. When the old API is ready, replace this with a real check that returns the same shape as newApi().
async function oldApi() {
  return { state: 'off', title: 'Not connected', reason: 'The old API is not connected to this status check yet.', lastRunAt: null, lastRunStatus: null, lastGoodAt: null, errors: [] };
}

export async function apiStatus() {
  const [n, o] = await Promise.allSettled([newApi(), oldApi()]);
  const unknown = e => ({ state: 'unknown', title: 'Status unavailable', reason: text(e?.message || 'The status check failed.'), lastRunAt: null, lastRunStatus: null, lastGoodAt: null, errors: [] });
  return { generatedAt: new Date().toISOString(), new: n.status === 'fulfilled' ? n.value : unknown(n.reason), old: o.status === 'fulfilled' ? o.value : unknown(o.reason) };
}
