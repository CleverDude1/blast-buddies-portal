// Clan Performance data, used by api/hourly.js:
//   /api/hourly?mode=clan-perf              -> overview: every clan on the newest board + its gain in the last hour / today
//   /api/hourly?mode=clan-perf&id=CLAN_ID   -> one clan: hourly gains (last HOURLY_DAYS days) and daily kills (last HISTORY_DAYS days)
//
// It only reads the stored clan snapshots (raw_snapshots, source = 'clan'), same as the rest of the site, and never calls the Pangolin API.
// The clan board is "kills this month", so it resets once a month: when a clan's value goes DOWN between two snapshots we count the new
// value as the kills since the reset (same rule as api/hourly.js).
//
// How the history is built (to keep it fast):
//   - the last HOURLY_DAYS days: EVERY snapshot is read, so we get kills for each hourly gap
//   - older days (up to HISTORY_DAYS): only the LAST snapshot of each UTC day is read, enough for daily totals
// Lower HOURLY_DAYS if the request times out on your plan; raise it for a better peak-hour picture.
import { rest, extractList, normClan } from './shared.js';

const HOURLY_DAYS = 14;
const HISTORY_DAYS = 30;
const MIN = 60e3, DAY = 864e5;
const MAX_FINE_GAP = 90 * MIN;       // a gap longer than this is not counted as "one hour"
const MAX_DAY_GAP = 36 * 60 * MIN;   // a gap longer than this (clan off the board, collector down) is skipped
const CHUNK = 12;
const enc = encodeURIComponent;
const SRC = `source=eq.${enc('clan')}`;
const iso = ms => new Date(ms).toISOString();
const dayStart = ms => Math.floor(ms / DAY) * DAY;
const kills = r => Number(r.kills ?? 0) || 0;
const members = r => Number(r.member_count ?? r.members ?? 0) || 0;
const tagOf = r => r.tag ?? r.clan_tag ?? '';
const colorOf = r => r.color ?? r.clan_color ?? null;

// raw payload -> clans ranked by kills (same as the Rankings page)
function rowsOf(payload) {
  const list = extractList(payload, 'clanId');
  if (!list) return null;
  return list.map(normClan).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1)).map((r, i) => ({ ...r, rank: i + 1 }));
}

async function pool(items, n, fn) {   // run fn over items, at most n at a time
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function newest() {
  const [row] = await rest(`raw_snapshots?select=fetched_at,payload&${SRC}&order=fetched_at.desc&limit=1`);
  return row ? { at: Date.parse(row.fetched_at), rows: rowsOf(row.payload) } : null;
}
async function aboutAnHourBefore(refAt) {
  const lo = iso(refAt - 150 * MIN), hi = iso(refAt - 30 * MIN);
  const metas = await rest(`raw_snapshots?select=id,fetched_at&${SRC}&fetched_at=gte.${enc(lo)}&fetched_at=lte.${enc(hi)}&order=fetched_at.desc&limit=20`);
  if (!metas.length) return null;
  const want = refAt - 60 * MIN;
  const best = metas.reduce((a, b) => Math.abs(Date.parse(b.fetched_at) - want) < Math.abs(Date.parse(a.fetched_at) - want) ? b : a);
  const [row] = await rest(`raw_snapshots?select=payload&id=eq.${best.id}`);
  return row ? { at: Date.parse(best.fetched_at), rows: rowsOf(row.payload) } : null;
}
async function firstOfToday(refAt) {
  const [row] = await rest(`raw_snapshots?select=fetched_at,payload&${SRC}&fetched_at=gte.${enc(iso(dayStart(refAt)))}&order=fetched_at.asc&limit=1`);
  return row ? { at: Date.parse(row.fetched_at), rows: rowsOf(row.payload) } : null;
}
// kills gained by each clan between two boards (a drop means the board reset, so the new value counts)
function gains(now, before) {
  const m = new Map();
  if (!before?.rows || before.at >= now.at) return m;
  const prev = new Map(before.rows.map(r => [String(r.clan_id), r]));
  for (const r of now.rows) {
    const a = prev.get(String(r.clan_id));
    if (a) m.set(String(r.clan_id), kills(r) >= kills(a) ? kills(r) - kills(a) : kills(r));
  }
  return m;
}

async function overview(cur) {
  const safe = p => p.catch(e => { console.error('clan-perf overview:', e.message); return null; });
  const [hourAgo, dayStartSnap] = await Promise.all([safe(aboutAnHourBefore(cur.at)), safe(firstOfToday(cur.at))]);
  const gh = gains(cur, hourAgo), gd = gains(cur, dayStartSnap);
  return {
    ok: true, mode: 'overview', at: iso(cur.at),
    hourSpanMin: hourAgo ? Math.round((cur.at - hourAgo.at) / MIN) : null,
    daySince: dayStartSnap && dayStartSnap.at < cur.at ? iso(dayStartSnap.at) : null,
    clans: cur.rows.map(r => ({
      id: String(r.clan_id), name: r.name, tag: tagOf(r), color: colorOf(r), kills: kills(r), members: members(r), rank: r.rank,
      gainHour: gh.has(String(r.clan_id)) ? gh.get(String(r.clan_id)) : null,
      gainDay: gd.has(String(r.clan_id)) ? gd.get(String(r.clan_id)) : null,
    })),
  };
}

export async function clanPerformance(query) {
  const cur = await newest();
  if (!cur || !cur.rows || !cur.rows.length) return { ok: false, error: 'no clan data stored yet' };
  const id = String(query.id || '').trim();
  if (!id) return overview(cur);

  const me = cur.rows.find(r => String(r.clan_id) === id);
  if (!me) return { ok: true, mode: 'clan', found: false, id, at: iso(cur.at) };

  const today = dayStart(cur.at);
  const hourlyFrom = today - (HOURLY_DAYS - 1) * DAY, histFrom = today - (HISTORY_DAYS - 1) * DAY;

  // 1) every snapshot of the recent days
  const metas = await rest(`raw_snapshots?select=id,fetched_at&${SRC}&fetched_at=gte.${enc(iso(hourlyFrom))}&order=fetched_at.asc&limit=2000`);
  const atOf = new Map(metas.map(m => [m.id, Date.parse(m.fetched_at)]));
  const chunks = [];
  for (let i = 0; i < metas.length; i += CHUNK) chunks.push(metas.slice(i, i + CHUNK).map(m => m.id));
  const fineRows = (await pool(chunks, 6, c => rest(`raw_snapshots?select=id,payload&id=in.(${c.join(',')})`))).flat();

  // 2) the last snapshot of each older day
  const olderDays = [];
  for (let t = histFrom; t < hourlyFrom; t += DAY) olderDays.push(t);
  const olderRows = (await pool(olderDays, 6, async t => {
    const [row] = await rest(`raw_snapshots?select=fetched_at,payload&${SRC}&fetched_at=gte.${enc(iso(t))}&fetched_at=lt.${enc(iso(t + DAY))}&order=fetched_at.desc&limit=1`);
    return row || null;
  })).filter(Boolean);

  // this clan's value in each snapshot (null = it was not on the board then)
  const pick = payload => {
    const r = rowsOf(payload)?.find(x => String(x.clan_id) === id);
    return r ? { kills: kills(r), rank: r.rank } : null;
  };
  const pts = [];
  for (const r of olderRows) { const v = pick(r.payload); if (v) pts.push({ at: Date.parse(r.fetched_at), ...v }); }
  for (const r of fineRows) { const v = pick(r.payload); if (v) pts.push({ at: atOf.get(r.id), ...v }); }
  pts.sort((a, b) => a.at - b.at);

  // gains between neighbouring snapshots
  const hourly = [], dayKills = new Map(), dayPartial = new Map(), dayRank = new Map();
  for (const p of pts) dayRank.set(dayStart(p.at), p.rank);          // last rank seen that day
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], gap = b.at - a.at;
    if (gap > MAX_DAY_GAP) continue;                                  // too long a gap to say anything
    const reset = b.kills < a.kills, gain = reset ? b.kills : b.kills - a.kills, fine = gap <= MAX_FINE_GAP;
    const day = fine ? dayStart((a.at + b.at) / 2) : dayStart(b.at);
    dayKills.set(day, (dayKills.get(day) || 0) + gain);
    if (!fine && b.at >= hourlyFrom) dayPartial.set(day, true);       // a hole in the hourly data
    if (fine) hourly.push([Math.round((a.at + b.at) / 2), gain, reset ? 1 : 0]);
  }
  const daily = [...dayKills.entries()].sort((x, y) => x[0] - y[0])
    .map(([d, k]) => [d, k, d >= today || dayPartial.get(d) ? 1 : 0, dayRank.get(d) ?? null]);

  const total = cur.rows.reduce((s, r) => s + kills(r), 0);
  return {
    ok: true, mode: 'clan', found: true, at: iso(cur.at),
    clan: { id, name: me.name, tag: tagOf(me), color: colorOf(me), kills: kills(me), members: members(me), rank: me.rank,
            share: total ? kills(me) / total : 0, clans: cur.rows.length },
    hourlyDays: HOURLY_DAYS, historyDays: HISTORY_DAYS, snapshots: pts.length,
    hourly,   // [middle of the hour (ms), kills, 1 if the board reset in this gap]
    daily,    // [UTC day start (ms), kills, 1 if incomplete, rank at end of day]
  };
}
