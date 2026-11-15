// API health for the "New API" / "Old API" buttons in the top bar.
//   /api/hourly?mode=status  ->  { generatedAt, new: {...}, old: {...} }
//
// "New API" = api/board-new.js, the main API for now. It is checked LIVE: a short request to each of the game's calls that board-new uses
//   (daily, weekly, ranked, clans on na1-ping, with the player id; eu1-ping counts too, as board-new tries it as a second address).
//   - ok   = all four answer with real rows        -> green
//   - warn = only some answer                       -> still green on the button, with a "!" badge
//   - down = none answer                            -> red
//   The hourly collector is checked too (what api/collect.js wrote to collection_runs). If the live API works but the collection has
//   problems, the state is "warn" (green with "!") and the reason says so.
//
// "Old API" = api/board.js, kept as it was: the game's older calls (eu1-ping / na1-ping, no player id). Also checked LIVE the same way.
// The top bar script (js/status.js) turns the two into the button colours: yellow standby while the New API works, green when the
// Old API has taken over (New down, Old answering), red when both are down.
// Live checks are remembered for 2 minutes so visitors do not each hit the game's servers.
// Env vars (Vercel): SUPABASE_URL, SUPABASE_SECRET_KEY, BB_PLAYER_ID (optional), RANKED_SEASON (optional, default 3)
import { rest, extractList } from './shared.js';

const MIN = 60e3;
const OK_MIN = 75;        // the collector runs at minute 55 every hour: a good run up to 75 minutes old is normal
const DOWN_MIN = 150;     // no good run for this long = red
const CRASH_MIN = 15;     // a run that started this long ago and never finished crashed or timed out
const FINISHED = new Set(['ok', 'partial', 'failed']);
const LEVEL = { ok: 0, warn: 1, down: 2 };

const iso = ms => (ms == null ? null : new Date(ms).toISOString());
const text = v => String(v ?? '').slice(0, 220);

// the hourly collection (what api/collect.js wrote to collection_runs)
async function collectorStatus() {
  const now = Date.now();
  const rows = await rest('collection_runs?select=id,started_at,finished_at,status,errors,summary&order=started_at.desc&limit=12');
  const runs = rows.map(r => ({
    startedAt: Date.parse(r.started_at),
    finishedAt: r.finished_at ? Date.parse(r.finished_at) : null,
    status: FINISHED.has(r.status) ? r.status : null,                 // null = still running or never finished
    errors: Array.isArray(r.errors) ? r.errors : [],
    sources: r.summary?.sources || null,                                // { primary: [...], fallback: [...] } written by collect.js
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
    // collect.js records which API delivered each board. If the new API delivered none, it is down, even though the run itself
    // may be saved as "partial" because the old-API backup stored the data
    if (last.sources && Array.isArray(last.sources.primary) && last.sources.primary.length === 0)
      bump('down', last.sources.fallback && last.sources.fallback.length
        ? 'The collector\'s combined source delivered nothing in the last collection, so it used the direct game fallback instead.'
        : 'The collector\'s combined source delivered nothing in the last collection.');
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

// ---------- live checks of the game's servers ----------
const PLAYER_ID = process.env.BB_PLAYER_ID || 'pEyooYhCf-xj', PIDQ = encodeURIComponent(PLAYER_ID);
const SEASON = encodeURIComponent(process.env.RANKED_SEASON || 3);
const NA = 'https://na1-ping.blastbuddies.io/api/leaderboard', EU = 'https://eu1-ping.blastbuddies.io/api/leaderboard';
const SETS = {
  // the calls api/board-new.js makes (any one of the addresses answering counts)
  new: [
    { name: 'Daily',  idKey: 'playerId', urls: [`${NA}/day?playerId=${PIDQ}`,    `${EU}/day?playerId=${PIDQ}`] },
    { name: 'Weekly', idKey: 'playerId', urls: [`${NA}/week?playerId=${PIDQ}`,   `${EU}/week?playerId=${PIDQ}`] },
    { name: 'Ranked', idKey: 'playerId', urls: [`${NA}/ranked?season=${SEASON}&playerId=${PIDQ}`, `${EU}/ranked?season=${SEASON}&playerId=${PIDQ}`] },
    { name: 'Clans',  idKey: 'clanId',   urls: [`${NA}/clans`, `${EU}/clans`] },
  ],
  // the calls api/board.js (the old API) makes
  old: [
    { name: 'Daily',  idKey: 'playerId', urls: [`${EU}/day`] },
    { name: 'Weekly', idKey: 'playerId', urls: [`${EU}/week`] },
    { name: 'Ranked', idKey: 'playerId', urls: [`${NA}/ranked?season=${SEASON}`] },
    { name: 'Clans',  idKey: 'clanId',   urls: [`${EU}/clans`] },
  ],
};
const TTL = 2 * MIN, cache = {};

async function probeUrl(url, idKey) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = extractList(await r.json(), idKey);
    if (!Array.isArray(list) || !list.length) throw new Error('answered, but with no rows');
    return null;
  } catch (e) { return e.name === 'AbortError' ? 'no answer within 6 seconds' : String(e.message || e); }
  finally { clearTimeout(timer); }
}
async function probeBoard(c) {                      // the first address that answers wins; otherwise the first address's error is reported
  let firstErr = null;
  for (const url of c.urls) { const err = await probeUrl(url, c.idKey); if (!err) return null; firstErr = firstErr || err; }
  return firstErr;
}
async function liveCheck(which) {
  if (cache[which] && Date.now() - cache[which].t < TTL) return cache[which].v;
  const results = await Promise.all(SETS[which].map(async c => ({ c, err: await probeBoard(c) })));
  const good = results.filter(x => !x.err).length, total = results.length;
  const v = { state: good === total ? 'ok' : good > 0 ? 'warn' : 'down', good, total,
    errors: results.filter(x => x.err).slice(0, 4).map(x => ({ where: x.c.name, message: text(x.err) })) };
  cache[which] = { t: Date.now(), v };
  return v;
}

const TITLE = { ok: 'Working', warn: 'Working with problems', down: 'Not working' };

async function newApi() {
  const [live, coll] = await Promise.all([liveCheck('new'), collectorStatus().catch(() => null)]);
  let state = live.state, reason;
  if (live.state === 'ok') reason = 'The new API is answering for all four boards (daily, weekly, ranked, clans).';
  else if (live.state === 'warn') reason = `Only ${live.good} of ${live.total} boards are answering from the new API.`;
  else reason = 'None of the boards are answering from the new API.';
  // the live API works but the hourly collection has trouble: still "working", with the "!" badge
  if (live.state === 'ok' && coll && coll.state !== 'ok') { state = 'warn'; reason = `The new API is answering, but the hourly collection has problems: ${coll.reason}`; }
  return {
    state, title: TITLE[state], reason,
    lastRunAt: coll?.lastRunAt ?? null, lastRunStatus: coll?.lastRunStatus ?? null, lastGoodAt: coll?.lastGoodAt ?? null,
    errors: live.errors.length ? live.errors : (coll?.errors || []),
  };
}

async function oldApi() {
  const live = await liveCheck('old');
  const reason = live.state === 'ok' ? 'The old API (board.js) is answering for all four boards.'
    : live.state === 'warn' ? `Only ${live.good} of ${live.total} boards are answering from the old API.` : 'None of the boards are answering from the old API.';
  return { state: live.state, title: TITLE[live.state], reason, lastRunAt: null, lastRunStatus: null, lastGoodAt: null, errors: live.errors };
}

export async function apiStatus() {
  const [n, o] = await Promise.allSettled([newApi(), oldApi()]);
  const unknown = e => ({ state: 'unknown', title: 'Status unavailable', reason: text(e?.message || 'The status check failed.'), lastRunAt: null, lastRunStatus: null, lastGoodAt: null, errors: [] });
  return { generatedAt: new Date().toISOString(), new: n.status === 'fulfilled' ? n.value : unknown(n.reason), old: o.status === 'fulfilled' ? o.value : unknown(o.reason) };
}
