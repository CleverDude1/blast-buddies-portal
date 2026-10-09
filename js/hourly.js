// Shared by the leaderboard pages: loads the snapshot from ~1 hour ago and builds the "+2k" labels and the up/down arrows.
// Everything lives inside HOURLY so it cannot clash with names in the page scripts.
const HOURLY = (() => {
  async function loadPrev(board) {                     // null if there is no snapshot yet (pages then simply show no changes)
    try {
      const r = await fetch(`/api/hourly?mode=prev&board=${board}`);
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.entries ? j : null;
    } catch (e) { return null; }
  }
  const short = n => {                                  // 52000 -> 52k, 1250000 -> 1.25M
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 100) / 100);
  };
  const ago = prev => {                                 // the snapshot is "about 1 hour" old, say exactly how old when it is not
    const m = prev.elapsedMin;
    return m >= 50 && m <= 70 ? '1h' : m < 90 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  };
  // rows: [{ id, rank, vals: { key: number } }]   spec: { key: 'high' | 'low' } (which direction is good)
  // resetKey: for daily/weekly boards, the value that drops when the board resets (then all changes are hidden)
  function marks(prev, rows, spec, resetKey) {
    if (!prev) return null;
    const pvOf = id => {
      const e = prev.entries[id]; if (!e) return null;
      const v = { ...e };
      if ('kdr' in spec && v.kills != null && v.deaths != null) v.kdr = v.deaths > 0 ? v.kills / v.deaths : v.kills;
      return v;
    };
    let reset = false;
    if (resetKey) {
      let n = 0, down = 0;
      for (const r of rows) { const p = prev.entries[r.id]; if (p && p[resetKey] != null && r.vals[resetKey] != null) { n++; if (r.vals[resetKey] < p[resetKey]) down++; } }
      reset = n > 0 && down / n > 0.5;
    }
    const label = ago(prev), out = new Map();
    for (const r of rows) {
      const p = pvOf(r.id); let move = ''; const d = {};
      if (!reset) {
        if (!p) move = '<i class="mv new">NEW</i>';
        else {
          const diff = p.rank - r.rank;
          if (diff > 0) move = `<i class="mv up" title="up ${diff} since ${label}">▲${diff}</i>`;
          else if (diff < 0) move = `<i class="mv down" title="down ${-diff} since ${label}">▼${-diff}</i>`;
          for (const [k, dir] of Object.entries(spec)) {
            const cur = r.vals[k], pr = p[k];
            if (cur == null || pr == null) continue;
            const x = cur - pr, good = x === 0 ? 0 : ((dir === 'high') === (x > 0) ? 1 : -1);
            const txt = x === 0 ? '0' : (x > 0 ? '+' : '-') + (k === 'kdr' ? Math.abs(x).toFixed(2) : short(Math.abs(x)));
            d[k] = `<div class="dlt ${good > 0 ? 'up' : good < 0 ? 'down' : 'zero'}">${txt}<small>${label}</small></div>`;
          }
        }
      }
      out.set(r.id, { move, d });
    }
    return { get: id => out.get(id) || { move: '', d: {} }, label, reset };
  }
  const note = m => !m ? '' : m.reset ? ' Board just reset, so hourly changes are hidden.' : ` Changes are compared with the snapshot from ${m.label} ago.`;
  return { loadPrev, marks, short, note };
})();
