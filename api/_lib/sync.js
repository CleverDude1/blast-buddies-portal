// Helpers for turning API rows into Supabase rows and storing only what changed.

const CHUNK = 150;

export const chunk = (arr, n = CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
    : v;

export const same = (a, b) =>
  JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));

// ---------------------------------------------------------------------
// API field name -> DB column name
// ---------------------------------------------------------------------
export const PLAYER_FIELDS = {
  playerId: 'player_id',
  name: 'name',
  totalXp: 'total_xp',
  characterSkinId: 'character_skin_id',
  topWeaponId: 'top_weapon_id',
  topWeaponSkinId: 'top_weapon_skin_id',
  clanTag: 'clan_tag',
  clanColor: 'clan_color',
};
export const ENTRY_FIELDS = {
  rank: 'rank',
  kills: 'kills',
  deaths: 'deaths',
  assists: 'assists',
  trophies: 'trophies',
  rankedWins: 'ranked_wins',
  rankedLosses: 'ranked_losses',
};
export const CLAN_FIELDS = {
  clanId: 'clan_id',
  name: 'name',
  tag: 'tag',
  color: 'color',
  memberCount: 'member_count',
  memberCap: 'member_cap',
  openJoin: 'open_join',
  kills: 'kills',
};

export const PLAYER_TRACKED = ['name', 'total_xp', 'character_skin_id', 'top_weapon_id', 'top_weapon_skin_id', 'clan_tag', 'clan_color'];
export const ENTRY_TRACKED = ['rank', 'kills', 'deaths', 'assists', 'trophies', 'ranked_wins', 'ranked_losses'];
export const CLAN_TRACKED = ['name', 'tag', 'color', 'member_count', 'member_cap', 'open_join', 'kills'];

function pick(raw, map) {
  const out = {};
  for (const [k, col] of Object.entries(map)) if (raw[k] !== undefined) out[col] = raw[k];
  return out;
}

// Any field we don't know about yet goes into `extra`, so nothing is ever lost.
function leftovers(raw, ...maps) {
  const known = new Set(maps.flatMap((m) => Object.keys(m)));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)));
}

// Accepts [..], { clanId... }, or { anything: [..] }
export function extractList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    if (json.clanId || json.playerId) return [json];
    for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  }
  return [];
}

export function ingestLeaderboard(source, list, players, entries) {
  list.forEach((raw, idx) => {
    if (!raw || !raw.playerId) return;
    players.set(raw.playerId, { ...players.get(raw.playerId), ...pick(raw, PLAYER_FIELDS) });
    entries.push({
      board: source.board,
      season: source.season,
      player_id: raw.playerId,
      ...pick(raw, ENTRY_FIELDS),
      rank: raw.rank ?? idx + 1,
      extra: leftovers(raw, PLAYER_FIELDS, ENTRY_FIELDS),
    });
  });
}

export function ingestClans(list, clans) {
  for (const raw of list) {
    if (!raw || !raw.clanId) continue;
    clans.set(raw.clanId, { ...pick(raw, CLAN_FIELDS), extra: leftovers(raw, CLAN_FIELDS) });
  }
}

// ---------------------------------------------------------------------
// Compare incoming rows to stored state; write history only on change.
// ---------------------------------------------------------------------
export async function syncEntities(db, { table, historyTable, keyCols, tracked, rows, runId, now, scope = {} }) {
  const stats = { seen: 0, new: 0, changed: 0, unchanged: 0 };
  const idCol = keyCols[keyCols.length - 1];
  const keyOf = (r) => keyCols.map((c) => r[c]).join('|');

  const byKey = new Map();
  for (const r of rows) if (r[idCol] != null) byKey.set(keyOf(r), r);
  rows = [...byKey.values()];
  stats.seen = rows.length;
  if (!rows.length) return stats;

  const compare = [...tracked, 'extra'];
  const dataCols = [...keyCols, ...tracked, 'extra'];

  // 1. load existing state
  const existing = new Map();
  for (const ids of chunk(rows.map((r) => r[idCol]))) {
    let q = db.from(table).select('*').in(idCol, ids);
    for (const [c, v] of Object.entries(scope)) q = q.eq(c, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table} load: ${error.message}`);
    for (const r of data) existing.set(keyOf(r), r);
  }

  // 2. work out what's new / changed / unchanged
  const upserts = [];
  const history = [];
  const touchIds = [];

  for (const incoming of rows) {
    const prev = existing.get(keyOf(incoming));

    if (!prev) {
      const full = Object.fromEntries(dataCols.map((c) => [c, incoming[c] ?? (c === 'extra' ? {} : null)]));
      upserts.push({ ...full, first_seen_at: now, last_seen_at: now, last_changed_at: now });
      history.push({ ...full, run_id: runId, observed_at: now, change_type: 'new', changes: null });
      stats.new++;
      continue;
    }

    const changes = {};
    for (const c of compare) {
      if (incoming[c] === undefined) continue; // field not provided by this API -> leave alone
      if (!same(prev[c], incoming[c])) changes[c] = { from: prev[c] ?? null, to: incoming[c] };
    }

    if (!Object.keys(changes).length) {
      touchIds.push(prev[idCol]);
      stats.unchanged++;
      continue;
    }

    const full = { ...prev };
    for (const c of Object.keys(changes)) full[c] = changes[c].to;
    upserts.push({ ...full, last_seen_at: now, last_changed_at: now });
    history.push({
      ...Object.fromEntries(dataCols.map((c) => [c, full[c] ?? (c === 'extra' ? {} : null)])),
      run_id: runId,
      observed_at: now,
      change_type: 'change',
      changes,
    });
    stats.changed++;
  }

  // 3. write (state first, then history)
  for (const batch of chunk(upserts, 500)) {
    const { error } = await db.from(table).upsert(batch, { onConflict: keyCols.join(',') });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  for (const batch of chunk(history, 500)) {
    const { error } = await db.from(historyTable).insert(batch);
    if (error) throw new Error(`${historyTable} insert: ${error.message}`);
  }
  for (const ids of chunk(touchIds)) {
    let q = db.from(table).update({ last_seen_at: now }).in(idCol, ids);
    for (const [c, v] of Object.entries(scope)) q = q.eq(c, v);
    const { error } = await q;
    if (error) throw new Error(`${table} touch: ${error.message}`);
  }

  return stats;
}
