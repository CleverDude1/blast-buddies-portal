// Shared by the leaderboard pages: loads the snapshot from ~1 hour ago and builds the "+2k" labels and the up/down arrows.
// Everything lives inside HOURLY so it cannot clash with names in the page scripts.
const HOURLY = (() => {
  // The chosen comparison is shared by every page (and the sidebar): 'hour' = vs ~1 hour ago, 'day' = vs the first snapshot after 00:00 UTC.
  const getSpan = () => { try { return localStorage.getItem('hrSpan') === 'day' ? 'day' : 'hour'; } catch (e) { return 'hour'; } };
  const setSpan = v => { try { localStorage.setItem('hrSpan', v); } catch (e) {} window.dispatchEvent(new Event('hr-span')); };
  // Adds the "Last hour | Last day" switch to the page toolbar. onChange() is called whenever the choice changes (also from the sidebar).
  function mountToggle(onChange) {
    const bar = document.querySelector('.toolbar');
    if (bar) {
      const seg = document.createElement('div');
      seg.className = 'seg'; seg.id = 'spanSeg';
      seg.innerHTML = '<button data-span="hour">Last hour</button><button data-span="day" title="Since 00:00 UTC">Last day</button>';
      bar.appendChild(seg);
      seg.addEventListener('click', e => { const b = e.target.closest('[data-span]'); if (b && b.dataset.span !== getSpan()) setSpan(b.dataset.span); });
    }
    const paint = () => document.querySelectorAll('#spanSeg button').forEach(b => b.classList.toggle('on', b.dataset.span === getSpan()));
    paint();
    window.addEventListener('hr-span', () => { paint(); onChange(); });
  }
  async function loadPrev(board) {                     // null if there is no snapshot yet (pages then simply show no changes)
    try {
      const r = await fetch(`/api/hourly?mode=prev&board=${board}&span=${getSpan()}`);
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
    if (prev.span === 'day') return 'today';
    const m = prev.elapsedMin;
    return m >= 50 && m <= 70 ? '1h' : m < 90 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  };
  // rows: [{ id, rank, vals: { key: number } }]   spec: { key: 'high' | 'low' } (which direction is good)
  // The server (api/hourly.js) adds up the changes over every snapshot and sends, per entry: its starting rank, its gain for each column (d),
  // and whether the number is partly an estimate (partial, shown with ~). This only turns that into labels and arrows.
  function marks(prev, rows, spec) {
    if (!prev || !prev.entries) return null;
    const label = ago(prev), reset = !!prev.reset, out = new Map();
    for (const r of rows) {
      const e = prev.entries[r.id]; let move = ''; const d = {};
      if (e) {
        if (!reset) {
          if (e.rank == null) move = '<i class="mv new" title="not in the top list at the start of this period">NEW</i>';
          else {
            const diff = e.rank - r.rank;
            if (diff > 0) move = `<i class="mv up" title="up ${diff} since ${label}">▲${diff}</i>`;
            else if (diff < 0) move = `<i class="mv down" title="down ${-diff} since ${label}">▼${-diff}</i>`;
          }
        }
        const tilde = e.partial ? '~' : '';
        for (const [k, dir] of Object.entries(spec)) {
          let x;
          if (k === 'kdr') {                                   // KDR change = KDR now - KDR at the start (start values = now - gain)
            const dk = e.d.kills, dd = e.d.deaths;
            if (dk == null || dd == null || r.vals.kills == null || r.vals.deaths == null) continue;
            const bk = r.vals.kills - dk, bd = r.vals.deaths - dd;
            x = r.vals.kdr - (bd > 0 ? bk / bd : bk);
          } else { x = e.d[k]; if (x == null || r.vals[k] == null) continue; }
          const good = Math.abs(x) < 1e-9 ? 0 : ((dir === 'high') === (x > 0) ? 1 : -1);
          const txt = good === 0 ? '0' : (x > 0 ? '+' : '-') + (k === 'kdr' ? Math.abs(x).toFixed(2) : short(Math.abs(x)));
          d[k] = `<div class="dlt ${good > 0 ? 'up' : good < 0 ? 'down' : 'zero'}"${e.partial ? ' title="partly estimated: this entry was outside the list for part of the period"' : ''}>${tilde}${txt}<small>${label}</small></div>`;
        }
      }
      out.set(r.id, { move, d });
    }
    return { get: id => out.get(id) || { move: '', d: {} }, label, reset, span: prev.span, at: prev.at };
  }
  const note = m => !m ? '' :
    (m.span === 'day' ? ` Changes today since 00:00 UTC, added up over every snapshot (~ = partly estimated).`
                      : ` Changes are compared with the snapshot from ${m.label} ago (~ = partly estimated).`)
    + (m.reset ? ' The board reset during this period, so position arrows are hidden.' : '');
  return { loadPrev, marks, short, note, getSpan, setSpan, mountToggle };
})();
