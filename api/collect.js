  // 1. Fetch the bundle
  const results = await Promise.allSettled(SOURCES.map((s) => fetchJson(s.url)));

  // 2. Cut it into boards, store raw slices, ingest
  const players = new Map();
  const clans = new Map();
  const entriesBySource = [];
  const boards = [];            // used by the records step
  let fetchedOk = 0;

  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const r = results[i];
    if (r.status === 'rejected') {
      errors.push({ source: s.key, error: String(r.reason?.message || r.reason) });
      continue;
    }
    const { json, status } = r.value;
    if (json?.metadata?.stale === true) {
      errors.push({ source: s.key, error: 'upstream snapshot is stale, skipped' });
      continue;
    }
    fetchedOk++;

    for (const b of BOARDS) {
      const top = b.pick(json);
      if (!Array.isArray(top) || !top.length) {
        errors.push({ source: b.key, error: 'board missing or empty in bundle' });
        continue;
      }
      // Same shape the old APIs returned ({ data: { top: [...] } }), so records.js and the diffs don't change.
      const payload = { data: { top } };
      const season = b.board === 'ranked'
        ? (json.ranked?.current?.season ?? json.metadata?.currentSeason ?? b.season)
        : b.season;

      if (STORE_RAW) {
        const { error } = await db.from('raw_snapshots').insert({
          run_id: run.id, source: b.key, url: b.url, http_status: status, fetched_at: now, payload,
        });
        if (error) errors.push({ source: b.key, step: 'raw', error: error.message });
      }

      summary[b.key] = { rows: top.length };
      boards.push({ b, payload });

      if (b.type === 'leaderboard') {
        const entries = [];
        const src = { key: b.key, board: b.board, season };
        ingestLeaderboard(src, top, players, entries);
        entriesBySource.push({ s: src, entries });
      } else {
        ingestClans(top, clans);
      }
    }
  }
