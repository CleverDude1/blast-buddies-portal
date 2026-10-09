// "What changed" report: totals, strongest clans, every player's / clan's gain and position change, and a graph. Data: api/hourly.js (mode=summary)
(() => {
  const LABEL = { day: 'Daily', week: 'Weekly', ranked: 'Ranked', clan: 'Clans' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString();
  const short = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };
  const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n));
  const utc = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const getSpan = () => { try { return localStorage.getItem('hrSpan') === 'day' ? 'day' : 'hour'; } catch (e) { return 'hour'; } };

  const q = new URLSearchParams(location.search);
  if (q.get('span') === 'day' || q.get('span') === 'hour') { try { localStorage.setItem('hrSpan', q.get('span')); } catch (e) {} }
  let span = getSpan(), date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : '', cur = q.get('board');
  if (!LABEL[cur]) cur = 'day';
  const cache = {};
  let data = null;

  function mv(x) {
    if (x.status === 'left') return '<span class="mv down">LEFT</span>';
    if (x.status === 'passed') return '<span class="mv new">IN &amp; OUT</span>';
    if (x.isNew) return '<span class="mv new">NEW</span>';
    return x.move > 0 ? `<span class="mv up">▲ ${x.move}</span>` : x.move < 0 ? `<span class="mv down">▼ ${-x.move}</span>` : '<span class="muted">-</span>';
  }
  const msg = t => `<p class="muted" style="padding:24px">${t}</p>`;

  function draw() {
    document.querySelectorAll('#phTabs button').forEach(b => b.classList.toggle('on', b.dataset.b === cur));
    document.querySelectorAll('#phSpan button').forEach(b => b.classList.toggle('on', b.dataset.span === span));
    $('phDateWrap').style.display = span === 'day' ? '' : 'none';
    $('phDate').value = date || todayStr(); $('phDate').max = todayStr();
    $('phTitle').textContent = span === 'hour' ? 'Past hour' : (date && date !== todayStr() ? `Day: ${date}` : 'Last day');
    const none = t => { $('phStats').innerHTML = ''; $('phPower').innerHTML = ''; $('phRows').innerHTML = msg(t); $('phChart').innerHTML = ''; $('phLegend').innerHTML = ''; $('phGraphNote').textContent = ''; };
    if (data === undefined) return none('Loading...');
    if (data === null) return none('Could not load the report.');
    const b = data.boards[cur], who = cur === 'clan' ? 'clans' : 'players';
    if (!b || !b.ok) return none(span === 'day' ? 'No stored snapshots for this day yet.' : 'No hourly data for this board yet. It needs a stored snapshot from about an hour ago.');

    $('phWhen').textContent = span === 'hour'
      ? `Live values compared with the snapshot from ${utc(b.at)} (${b.elapsedMin} min ago).`
      : b.live ? `Every stored snapshot since 00:00 UTC (${b.snapshots} so far, first at ${utc(b.at)}) plus the live values.`
               : `Every stored snapshot from 00:00 to 00:00 UTC on ${date} (${b.snapshots}).`;
    $('phGainHead').textContent = b.unit.charAt(0).toUpperCase() + b.unit.slice(1) + ' gained';
    CLANPOWER.render($('phPower'), b.strongest, b.unit, window.CLAN_COLORS);

    const card = (big, label, sub = '') => `<div class="ph-card"><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('phStats').innerHTML =
      card(signed(b.totalGain), `Total ${b.unit} gained`, `${b.gainers} ${who} gained`)
      + card(b.moved, 'Position changes', b.reset ? 'board reset: arrows hidden' : `${b.up} up · ${b.down} down`)
      + card(b.entered, `Entered the top list`) + card(b.left, 'Left the top list')
      + card(b.biggestClimb ? `▲ ${b.biggestClimb.move}` : '-', 'Biggest climb', b.biggestClimb ? esc(b.biggestClimb.name) : '')
      + card(b.biggestDrop ? `▼ ${-b.biggestDrop.move}` : '-', 'Biggest drop', b.biggestDrop ? esc(b.biggestDrop.name) : '');
    $('phRows').innerHTML = b.all.map(x => `<div class="lb-row ph-row"><span class="rank">${x.rank ?? '-'}</span>
      <span class="pname">${esc(x.name)}${x.tag ? ` <small class="muted">[${esc(x.tag)}]</small>` : ''}</span>
      <span class="dlt ${x.gain > 0 ? 'up' : x.gain < 0 ? 'down' : 'zero'}" style="margin:0;font-size:16px"${x.partial ? ' title="partly estimated: outside the list for part of the period"' : ''}>${x.partial ? '~' : ''}${signed(x.gain)}</span>
      <span class="muted">${x.prevRank != null ? '#' + x.prevRank : '-'}</span>${mv(x)}</div>`).join('') + msg('~ means the number is partly estimated: that entry was outside the top list for part of the period, so only what we could see is counted.');
    drawGraph(b);
  }

  // ---------- graph: one line per player/clan that changed, running total gained since the start ----------
  const color = i => `hsl(${(i * 137.508) % 360} 72% 62%)`;
  function niceTicks(min, max, n = 5) {
    if (min === max) max = min + 1;
    const raw = (max - min) / (n - 1), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(v);
    return out;
  }
  function drawGraph(b) {
    const el = $('phChart'), leg = $('phLegend'), S = b.series || [];
    $('phGraphTitle').textContent = `${cur === 'clan' ? 'Clans' : 'Players'} that changed (${S.length})`;
    $('phGraphNote').textContent = span === 'day' && cur === 'day'
      ? `Each line is a player's kills since 00:00 UTC, one point per stored snapshot. Hover a line to see who it is.`
      : `Each line is the running total of ${b.unit} gained since the start of the period, one point per stored snapshot. Hover a line to see who it is.`;
    if (!S.length) { el.innerHTML = '<div class="chart-empty">No changes to plot for this period.</div>'; leg.innerHTML = ''; return; }
    const t0 = Date.parse(b.at), t1 = Math.max(Date.parse(b.to), t0 + 1);
    const vals = S.flatMap(s => s.pts.map(p => p[1])), yt = niceTicks(Math.min(0, ...vals), Math.max(...vals)), y0 = yt[0], y1 = yt[yt.length - 1];
    const W = 960, H = 440, L = 66, R = 18, T = 14, B = 34;
    const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => H - B - (v - y0) / (y1 - y0 || 1) * (H - T - B);
    const xl = t => (t1 - t0) <= 2 * 864e5 ? new Date(t).toISOString().slice(11, 16) : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    let g = yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2a3322" stroke-dasharray="3 4"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${short(v)}</text>`).join('');
    g += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#555f48"/>`;
    g += Array.from({ length: 6 }, (_, i) => { const t = t0 + (t1 - t0) * i / 5; return `<text x="${X(t)}" y="${H - 10}" text-anchor="middle">${xl(t)}</text>`; }).join('');
    g += S.map((s, i) => `<path data-i="${i}" d="${s.pts.map((p, j) => (j ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${color(i)}" stroke-width="1.8" stroke-linejoin="round" opacity=".9"/>`).join('');
    g += S.map((s, i) => s.pts.map(p => `<circle data-i="${i}" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2" fill="${color(i)}"/>`).join('')).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg><div class="ph-tip" style="display:none"></div>`;
    leg.innerHTML = S.map((s, i) => `<span data-i="${i}"><i class="dot" style="background:${color(i)}"></i>${esc(s.name)} <b>${short(s.pts[s.pts.length - 1][1])}</b></span>`).join('');

    const svg = el.querySelector('svg'), tip = el.querySelector('.ph-tip');
    const hl = i => {
      svg.querySelectorAll('path').forEach(p => { p.classList.toggle('dim', i != null && +p.dataset.i !== i); p.classList.toggle('hl', i != null && +p.dataset.i === i); });
      svg.querySelectorAll('circle').forEach(c => c.classList.toggle('dim', i != null && +c.dataset.i !== i));
      leg.querySelectorAll('span').forEach(sp => sp.classList.toggle('on', i != null && +sp.dataset.i === i));
    };
    svg.addEventListener('mousemove', e => {
      const rc = svg.getBoundingClientRect(), mx = (e.clientX - rc.left) * W / rc.width, my = (e.clientY - rc.top) * H / rc.height;
      let best = null, bd = 20 * 20;
      S.forEach((s, i) => s.pts.forEach(p => { const dx = X(p[0]) - mx, dy = Y(p[1]) - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = [i, p]; } }));
      if (!best) { tip.style.display = 'none'; hl(null); return; }
      const er = el.getBoundingClientRect();
      hl(best[0]); tip.style.display = 'block'; tip.style.left = Math.min(e.clientX - er.left + 14, er.width - 190) + 'px'; tip.style.top = (e.clientY - er.top + 14) + 'px';
      tip.innerHTML = `<b style="color:${color(best[0])}">${esc(S[best[0]].name)}</b>${S[best[0]].tag ? ` [${esc(S[best[0]].tag)}]` : ''}<br>${fmt(best[1][1])} ${esc(b.unit)} · ${new Date(best[1][0]).toISOString().slice(11, 16)} UTC`;
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; hl(null); });
    leg.addEventListener('mouseover', e => { const sp = e.target.closest('[data-i]'); hl(sp ? +sp.dataset.i : null); });
    leg.addEventListener('mouseleave', () => hl(null));
  }

  async function load() {
    const sp = span, dt = span === 'day' ? date : '', key = `${sp}|${dt}`;
    if (cache[key] === undefined) {
      data = undefined; draw();
      try { const r = await fetch(`/api/hourly?mode=summary&span=${sp}${dt ? '&date=' + dt : ''}`); if (!r.ok) throw new Error('HTTP ' + r.status); cache[key] = await r.json(); }
      catch (e) { console.error(e); cache[key] = null; }
    }
    if (sp !== span || dt !== (span === 'day' ? date : '')) return;
    data = cache[key]; draw();
  }
  const url = () => `?board=${cur}${span === 'day' && date ? '&date=' + date : ''}`;
  $('phTabs').addEventListener('click', e => { const t = e.target.closest('[data-b]'); if (t) { cur = t.dataset.b; history.replaceState(null, '', url()); if (data) draw(); } });
  $('phSpan').addEventListener('click', e => { const t = e.target.closest('[data-span]'); if (t && t.dataset.span !== span) { try { localStorage.setItem('hrSpan', t.dataset.span); } catch (x) {} window.dispatchEvent(new Event('hr-span')); } });
  $('phDate').addEventListener('change', e => { date = e.target.value && e.target.value !== todayStr() ? e.target.value : ''; history.replaceState(null, '', url()); load(); });
  $('phToday').addEventListener('click', () => { date = ''; history.replaceState(null, '', url()); load(); });
  window.addEventListener('hr-span', () => { span = getSpan(); history.replaceState(null, '', url()); load(); });
  load();
})();
