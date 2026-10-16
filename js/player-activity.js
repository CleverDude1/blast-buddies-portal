// Player Activity page. Reads /api/stats?mode=activity (hourly snapshots of players online, table online_samples).
const PA_API = '/api/stats?mode=activity';
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];                 // show Monday first
const PEAK_SHARE = 0.85;                                // an hour is a "peak hour" when its average is at least this share of the busiest hour
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];

let paDays = 30, paTz = 'local', paCache = {}, paErr = false;

const pa$ = id => document.getElementById(id);
const paEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paFmt = n => Math.round(Number(n)).toLocaleString();
const hh = h => String(h).padStart(2, '0') + ':00';
const dur = m => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h ${r}m` : `${r}m`; };
const zone = () => paTz === 'utc' ? 'UTC' : 'your time';
// samples are taken at :55, so round to the nearest hour to get the hour they describe
function slot(ms) { const d = new Date(Math.round(ms / 36e5) * 36e5); return paTz === 'utc' ? { h: d.getUTCHours(), d: d.getUTCDay() } : { h: d.getHours(), d: d.getDay() }; }
const whenText = ms => new Date(ms).toLocaleString([], paTz === 'utc' ? { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + (paTz === 'utc' ? ' UTC' : '');

function analyze(samples) {
  if (!samples.length) return null;
  const mk = () => ({ n: 0, t: 0, na: 0, eu: 0, as: 0, rooms: 0 });
  const hour = Array.from({ length: 24 }, mk), dow = Array.from({ length: 7 }, mk), cell = Array.from({ length: 7 }, () => Array.from({ length: 24 }, mk)), sum = mk();
  let best = null, minT = Infinity, maxT = 0;
  for (const x of samples) {
    const t = Date.parse(x.sampled_at), s = slot(t);
    for (const o of [hour[s.h], dow[s.d], cell[s.d][s.h], sum]) { o.n++; o.t += x.total; o.na += x.na_players || 0; o.eu += x.eu_players || 0; o.as += x.as_players || 0; o.rooms += x.rooms || 0; }
    if (!best || x.total > best.total) best = { total: x.total, t };
    minT = Math.min(minT, t); maxT = Math.max(maxT, t);
  }
  const avg = (o, k = 't') => o.n ? o[k] / o.n : null;
  const hAvg = hour.map(o => avg(o)), dAvg = dow.map(o => avg(o));
  const known = hAvg.map((v, h) => v == null ? null : h).filter(h => h != null);
  const maxH = known.reduce((a, h) => hAvg[h] > hAvg[a] ? h : a), minH = known.reduce((a, h) => hAvg[h] < hAvg[a] ? h : a);
  const thr = hAvg[maxH] * PEAK_SHARE, isPeak = h => hAvg[h] != null && hAvg[h] >= thr;
  let start = maxH, len = 1;                                      // the run of peak hours around the busiest hour (wraps past midnight)
  while (len < 24 && isPeak((start + 23) % 24)) { start = (start + 23) % 24; len++; }
  while (len < 24 && isPeak((start + len) % 24)) len++;
  const dKnown = dAvg.map((v, d) => v == null ? null : d).filter(d => d != null);
  const topD = dKnown.reduce((a, d) => dAvg[d] > dAvg[a] ? d : a), lowD = dKnown.reduce((a, d) => dAvg[d] < dAvg[a] ? d : a);
  const grp = ds => { let n = 0, t = 0; for (const d of ds) { n += dow[d].n; t += dow[d].t; } return n ? t / n : null; };
  const wkend = grp([0, 6]), wkday = grp([1, 2, 3, 4, 5]);
  let bestCell = null, cellMax = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) { const v = avg(cell[d][h]); if (v != null) { cellMax = Math.max(cellMax, v); if (!bestCell || v > bestCell.v) bestCell = { d, h, v }; } }
  const regions = [['na', 'North America'], ['eu', 'Europe'], ['as', 'Asia']].map(([k, name]) => {
    const ha = hour.map(o => o.n ? o[k] / o.n : null), kn = ha.map((v, h) => v == null ? null : h).filter(h => h != null);
    return { k, name, avg: sum[k] / sum.n, peakH: kn.length ? kn.reduce((a, h) => ha[h] > ha[a] ? h : a) : null };
  });
  const regTotal = regions.reduce((s, r) => s + r.avg, 0) || 1;
  regions.forEach(r => { r.share = r.avg / regTotal * 100; });
  return { n: samples.length, hAvg, dAvg, maxH, minH, start, len, isPeak, topD, lowD, wkend, wkday, bestCell, cellMax, cell: cell.map(row => row.map(o => avg(o))),
    best, regions, avgAll: avg(sum), perRoom: sum.rooms ? sum.t / sum.rooms : null, spanDays: (maxT - minT) / 864e5, from: minT, last: samples[samples.length - 1] };
}

function tile(title, sub, value, notes = [], cls = '') {
  return `<div class="map-card pa-tile ${cls}"><div class="pa-t">${title}</div><div class="pa-s">${sub}</div><div class="map-val">${value}</div>${notes.map(n => `<div class="map-note">${n}</div>`).join('')}</div>`;
}

function render() {
  const app = pa$('paApp'), data = paCache[paDays];
  const controls = `<div class="pa-controls"><div class="seg">${RANGES.map(([d, l]) => `<button data-days="${d}" class="${d === paDays ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg"><button data-tz="local" class="${paTz === 'local' ? 'on' : ''}">Your time</button><button data-tz="utc" class="${paTz === 'utc' ? 'on' : ''}">UTC</button></div></div>`;
  if (!data) { app.innerHTML = controls + `<p class="pa-empty">${paErr ? '<b>Could not load player activity.</b> Check the Console (F12) for details.' : 'Loading...'}</p>`; return; }
  const a = analyze(data.samples || []);
  if (!a || a.n < 6) { app.innerHTML = controls + `<p class="pa-empty">Collecting data. A sample is taken every hour, so this page needs a few hours of data (${a ? a.n : 0} samples so far).</p>`; return; }

  const now = new Date(), nowH = paTz === 'utc' ? now.getUTCHours() : now.getHours(), nowM = paTz === 'utc' ? now.getUTCMinutes() : now.getMinutes();
  const minsUntil = H => { let m = ((H - nowH + 24) % 24) * 60 - nowM; if (m <= 0) m += 1440; return m; };
  const wide = a.len >= 20, inPeak = !wide && ((nowH - a.start + 24) % 24) < a.len, endH = (a.start + a.len) % 24;
  const lastT = Date.parse(a.last.sampled_at), fresh = Date.now() - lastT < 90 * 60e3, typical = a.hAvg[slot(lastT).h];
  const vs = fresh && typical ? Math.round((a.last.total / typical - 1) * 100) : null;

  const status = wide
    ? tile('Peak hours', 'Right now', 'No clear peak', ['Player numbers are fairly even through the day'])
    : inPeak
      ? tile('Peak hours', 'Right now', '<span class="pa-gold">Peak hours now</span>', [`Peak hours end in <b>${dur(minsUntil(endH))}</b> (${hh(endH)} ${zone()})`, vs == null ? '' : `Last sample: ${paFmt(a.last.total)} players (${vs >= 0 ? '+' : ''}${vs}% vs typical for this hour)`].filter(Boolean), 'hot')
      : tile('Peak hours', 'Right now', 'Not peak hours', [`Next peak starts in <b>${dur(minsUntil(a.start))}</b> (${hh(a.start)} ${zone()})`, vs == null ? '' : `Last sample: ${paFmt(a.last.total)} players (${vs >= 0 ? '+' : ''}${vs}% vs typical for this hour)`].filter(Boolean));
  const tiles = [
    status,
    tile('Peak window', zone() + ' · most players online', wide ? 'All day' : `${hh(a.start)} - ${hh(endH)}`, [wide ? 'No hour stands out' : `${a.len} hour${a.len === 1 ? '' : 's'} at 85% or more of the busiest hour`, `Busiest hour averages ${paFmt(a.hAvg[a.maxH])} players`]),
    tile('Most active day', 'Average players online', WD[a.topD], [`<span class="pa-ok">${paFmt(a.dAvg[a.topD])} players on average</span>`, `Quietest: ${WD[a.lowD]} (${paFmt(a.dAvg[a.lowD])})`]),
    tile('Busiest hour', zone(), hh(a.maxH), [`<span class="pa-ok">${paFmt(a.hAvg[a.maxH])} players on average</span>`]),
    tile('Quietest hour', zone(), hh(a.minH), [`${paFmt(a.hAvg[a.minH])} players on average`]),
    tile('Best day and time', zone() + ' · single busiest slot', a.bestCell ? `${WD[a.bestCell.d].slice(0, 3)} ${hh(a.bestCell.h)}` : '-', a.bestCell ? [`${paFmt(a.bestCell.v)} players on average`] : []),
    tile('Weekend vs weekdays', 'Sat + Sun compared with Mon - Fri', a.wkend != null && a.wkday ? `${a.wkend >= a.wkday ? '+' : ''}${Math.round((a.wkend / a.wkday - 1) * 100)}%` : '-', a.wkend != null && a.wkday ? [`Weekends ${paFmt(a.wkend)} · weekdays ${paFmt(a.wkday)} players on average`] : ['Needs data from both']),
    tile('Busiest moment', 'Most players seen in one snapshot', paFmt(a.best.total), [`<span class="pa-ok">${whenText(a.best.t)}</span>`, data.peak ? `All-time peak: ${paFmt(data.peak.total)}` : '']).replace('<div class="map-note"></div>', ''),
    tile('Average online', `Last ${paDays} days`, paFmt(a.avgAll), [a.perRoom ? `About ${a.perRoom.toFixed(1)} players per room` : '', `${paFmt(a.n)} snapshots`].filter(Boolean)),
  ].join('');

  const max = a.hAvg[a.maxH];
  const bars = a.hAvg.map((v, h) => `<div class="pa-col${a.isPeak(h) && !wide ? ' peak' : ''}${h === nowH ? ' now' : ''}" title="${hh(h)} · ${v == null ? 'no data' : 'average ' + paFmt(v) + ' players'}"><i style="height:${v == null ? 0 : Math.max(2, v / max * 100)}%"></i></div>`).join('');
  const labels = Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('');
  const dMax = Math.max(...a.dAvg.filter(v => v != null));
  const dayRows = WD_ORDER.map(d => `<div class="pa-day${d === a.topD ? ' top' : ''}"><span>${WD[d]}</span><div class="tr"><i style="width:${a.dAvg[d] == null ? 0 : a.dAvg[d] / dMax * 100}%"></i></div><b>${a.dAvg[d] == null ? '-' : paFmt(a.dAvg[d])}</b></div>`).join('');
  const heat = `<div></div>${Array.from({ length: 24 }, (_, h) => `<div class="hd">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>`).join('')}`
    + WD_ORDER.map(d => `<div class="rl">${WD[d].slice(0, 3)}</div>` + a.cell[d].map((v, h) => {
        const best = a.bestCell && a.bestCell.d === d && a.bestCell.h === h;
        return `<div class="c${best ? ' best' : ''}" style="background:${v == null ? '#0b0f08' : `rgba(111,220,122,${(0.08 + 0.92 * v / a.cellMax).toFixed(2)})`}" title="${WD[d]} ${hh(h)} · ${v == null ? 'no data' : 'average ' + paFmt(v) + ' players'}"></div>`;
      }).join('')).join('');
  const regRows = a.regions.map(r => `<tr><td><b>${r.name}</b></td><td>${paFmt(r.avg)}</td><td><div class="sh"><i style="width:${Math.max(2, r.share)}px"></i>${Math.round(r.share)}%</div></td><td>${r.peakH == null ? '-' : hh(r.peakH)}</td></tr>`).join('');

  app.innerHTML = controls + `<div class="map-grid">${tiles}</div>
    <section class="pa-card"><h3>Average players by hour of the day</h3><div class="muted">${zone()}${wide ? '' : ' · gold bars are peak hours'} · the white outline is the current hour</div>
      <div class="pa-bars">${bars}</div><div class="pa-labels">${labels}</div>
      <div class="pa-key"><span><i style="background:#ffd24d"></i>Peak hours</span><span><i style="background:#6fdc7a"></i>Other hours</span></div></section>
    <section class="pa-card"><h3>Average players by day of the week</h3><div class="muted">${zone()}</div><div class="pa-days">${dayRows}</div></section>
    <section class="pa-card"><h3>Busiest times of the week</h3><div class="muted">${zone()} · brighter = more players · the white outline is the busiest slot</div><div class="pa-heat">${heat}</div></section>
    <section class="pa-card"><h3>By region</h3><div class="muted">Average players online and each region's busiest hour (${zone()})</div>
      <table class="pa-reg"><tr><th>Region</th><th>Average</th><th>Share of players</th><th>Busiest hour</th></tr>${regRows}</table></section>
    <p class="pa-note">Based on ${paFmt(a.n)} hourly snapshots from ${new Date(a.from).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} (${a.spanDays.toFixed(1)} days).
      A peak hour is any hour averaging at least ${Math.round(PEAK_SHARE * 100)}% of the busiest hour. ${a.spanDays < 7 ? 'Day-of-week numbers get more reliable once a full week of data is collected.' : ''}</p>`;
}

pa$('paApp').addEventListener('click', e => {
  const d = e.target.closest('[data-days]'), z = e.target.closest('[data-tz]');
  if (d) { paDays = Number(d.dataset.days); load(); }
  if (z) { paTz = z.dataset.tz; render(); }
});
async function load() {
  if (paCache[paDays]) { render(); return; }
  render();
  try { const r = await fetch(`${PA_API}&days=${paDays}`); if (!r.ok) throw new Error('HTTP ' + r.status); paCache[paDays] = await r.json(); paErr = false; }
  catch (e) { console.warn('activity failed:', e); paErr = true; }
  render();
}
load();
setInterval(render, 60000);   // keeps the "peak ends in ..." countdown fresh
