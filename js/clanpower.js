// "Strongest clans": a clan is stronger the more of its players are on the board and the higher their scores, so clans are ranked by the
// TOTAL score of their members on the board (members counted too). Example: "BEE is the strongest clan: 14.2k kills from 5 members".
const CLANPOWER = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };
  // items: [{ tag, color, score }]  ->  top 3 clans [{ tag, color, members, total }]
  function top3(items) {
    const m = new Map();
    for (const it of items) {
      if (!it.tag) continue;
      const t = m.get(it.tag) || { tag: it.tag, color: it.color ?? null, members: 0, total: 0 };
      t.members++; t.total += Number(it.score) || 0; m.set(it.tag, t);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.members - a.members).slice(0, 3);
  }
  // el: container element, top: result of top3 (or the server's `strongest`), unit: 'kills' | 'trophies', colors: CLAN_COLORS (optional)
  function render(el, top, unit, colors, extra = '', title = 'STRONGEST CLANS ON THIS LEADERBOARD') {
    if (!el) return;
    if (!top || !top.length) { el.innerHTML = ''; return; }
    const col = c => (colors && colors[c]) || '#ffffff';
    el.innerHTML = `<div class="cp"><div class="cp-title"><span>${esc(title)}</span>${extra}</div><div class="cp-list">${top.map((t, i) =>
      `<div class="cp-item"><b class="cp-n">${i + 1}</b><span class="cp-tag" style="color:${col(t.color)}">${esc(t.tag)}</span>`
      + `<span class="cp-txt">${short(t.total)} ${esc(unit)} from ${t.members} member${t.members === 1 ? '' : 's'}</span></div>`).join('')}</div></div>`;
  }
  return { top3, render };
})();
