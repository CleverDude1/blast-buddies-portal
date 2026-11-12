// Animated War Room background: candle glow, drifting particles, breathing characters.
// All coordinates below are PIXELS OF THE ORIGINAL 1672 x 941 IMAGE, so they are easy to tune by eye.
(() => {
  const W = 1672, H = 941;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Tweak everything here ----------
  const LIGHTS = [
    // chandelier candles
    { x: 141, y: 150, size: 6,  flame: true, swing: true }, { x: 193, y: 183, size: 5,  flame: true, swing: true },
    { x: 237, y: 148, size: 6,  flame: true, swing: true }, { x: 337, y: 158, size: 5,  flame: true, swing: true },
    { x: 409, y: 145, size: 6.5, flame: true, swing: true }, { x: 436, y: 190, size: 5,  flame: true, swing: true },
    // table candle
    { x: 703, y: 575, size: 9,  flame: true },
    // fireplace candles
    { x: 1601, y: 330, size: 5, flame: true }, { x: 1638, y: 350, size: 4.5, flame: true },
    // lanterns (glow only, no particles)
    { x: 66, y: 562, size: 6 }, { x: 385, y: 472, size: 5.5 }, { x: 1418, y: 362, size: 5 },
    // fireplace fire
    { x: 1530, y: 650, size: 19, fire: true, strength: 1.2, wild: 1.6 }
  ];

  // Outlines traced around each character (px of the image). feet = pivot point for the breathing.
  const CHARS = [
    { name: 'left',   dur: 4.8, delay: 0,   feet: [420, 915],
      pts: [[375,545],[440,522],[500,545],[520,600],[510,640],[540,690],[540,730],[520,760],[530,830],[520,890],[420,915],[330,880],[315,790],[312,700],[335,640],[358,590]] },
    { name: 'middle', dur: 5.4, delay: -1.7, feet: [900, 610],
      pts: [[868,445],[905,432],[950,445],[968,490],[985,540],[990,600],[850,608],[808,560],[812,520],[840,480]] },
    { name: 'right',  dur: 4.4, delay: -3.1, feet: [1250, 915],
      pts: [[1195,478],[1245,470],[1300,490],[1325,530],[1320,580],[1370,640],[1385,700],[1345,740],[1345,830],[1330,905],[1250,915],[1150,905],[1145,820],[1125,690],[1140,640],[1155,560],[1165,510]] }
  ];

  // Chandelier: hangs from the pivot (top of the chain) and swings slowly. The outline covers chain, ring and candles.
  const CHANDELIER = {
    pivot: [285, 0],
    swingDeg: 0.55,      // how far it swings each way (degrees), keep it small
    period: 7.5,         // seconds for one full swing
    pts: [[272,0],[305,0],[308,125],[455,125],[460,285],[120,285],[118,125],[268,125]]
  };

  const WINDOW = { x0: 62, x1: 195, y0: 135, y1: 535 };   // where light motes appear
  const CANDLE_PARTICLE_RATE = 0.35;   // per candle, particles per second (very low)
  const WINDOW_PARTICLE_RATE = 6;      // whole window, particles per second (was 1.6)
  // -------------------------------------------

  const pc = (v, total) => (v / total * 100).toFixed(3) + '%';

  // Build the DOM
  const root = document.createElement('div');
  root.className = 'ambient';
  root.setAttribute('aria-hidden', 'true');
  const stage = document.createElement('div');
  stage.className = 'ambient-stage';
  root.append(stage);

  // breathing layers
  CHARS.forEach(c => {
    const el = document.createElement('div');
    el.className = 'breather';
    el.style.clipPath = 'polygon(' + c.pts.map(p => pc(p[0], W) + ' ' + pc(p[1], H)).join(',') + ')';
    el.style.transformOrigin = pc(c.feet[0], W) + ' ' + pc(c.feet[1], H);
    el.style.setProperty('--dur', c.dur + 's');
    el.style.setProperty('--delay', c.delay + 's');
    stage.append(el);
  });

  // swinging chandelier: a clipped copy of the artwork plus its candle glows, all rotated together
  const swing = document.createElement('div');
  swing.className = 'swing';
  swing.style.transformOrigin = pc(CHANDELIER.pivot[0], W) + ' ' + pc(CHANDELIER.pivot[1], H);
  const swingImg = document.createElement('div');
  swingImg.className = 'swing-img';
  swingImg.style.clipPath = 'polygon(' + CHANDELIER.pts.map(p => pc(p[0], W) + ' ' + pc(p[1], H)).join(',') + ')';
  swing.append(swingImg);
  stage.append(swing);

  stage.insertAdjacentHTML('beforeend', '<div class="moonlight"></div>');

  // glows
  const lights = LIGHTS.map(l => {
    const el = document.createElement('div');
    el.className = 'glow' + (l.fire ? ' fire' : '');
    el.style.left = pc(l.x, W);
    el.style.top = pc(l.y, H);
    el.style.width = l.size + '%';
    el.style.aspectRatio = '1';
    stage.append(el);
    return { ...l, el, v: 1, t: 1, next: 0, ph: Math.random() * 100, strength: l.strength || 1, wild: l.wild || 1 };
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'ambientParticles';
  stage.append(canvas);
  const veil = document.createElement('div');
  veil.className = 'ambient-veil';
  root.append(veil);
  document.body.prepend(root);

  // ---------- Candle flicker: smoothed random target + slow sways + a shared draught ----------
  function flicker(l, dt, now, draught) {
    if (now >= l.next) {
      l.t = 0.74 + Math.random() * 0.3;
      l.next = now + 0.05 + Math.random() * 0.22 / l.wild;
      if (Math.random() < 0.025) l.t = 0.5;             // occasional guttering dip
    }
    l.v += (l.t - l.v) * Math.min(1, dt * 9);
    const sway = 0.05 * Math.sin(now * 1.7 + l.ph) + 0.035 * Math.sin(now * 3.3 + l.ph * 2.1);
    return Math.max(0.3, Math.min(1.15, (l.v + sway + draught) * l.strength));
  }

  // ---------- Particles ----------
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, scale = 1, parts = [];
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = cw / W;
  }
  addEventListener('resize', resize);
  resize();

  const rnd = (a, b) => a + Math.random() * (b - a);
  const flames = LIGHTS.filter(l => l.flame);

  let swingAngle = 0;   // degrees, updated every frame
  function swung(x, y, deg) {
    const [px, py] = CHANDELIER.pivot, r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c];
  }

  function spawnCandle() {
    const f = flames[(Math.random() * flames.length) | 0];
    const [fx, fy] = f.swing ? swung(f.x, f.y, swingAngle) : [f.x, f.y];
    parts.push({ kind: 'ember', x: fx + rnd(-3, 3), y: fy - 8, vx: rnd(-1.5, 1.5), vy: -rnd(4, 9),
                 r: rnd(0.45, 0.9), life: 0, max: rnd(7, 13), a: rnd(0.2, 0.4), ph: Math.random() * 6.28 });
  }
  function spawnWindow() {
    parts.push({ kind: 'mote', x: rnd(WINDOW.x0, WINDOW.x1), y: rnd(WINDOW.y0, WINDOW.y1), vx: rnd(3, 6), vy: rnd(1, 3),
                 r: rnd(0.8, 1.7), life: 0, max: rnd(14, 24), a: rnd(0.25, 0.5), ph: Math.random() * 6.28 });
  }

  let candleAcc = 0, windowAcc = 0;
  function stepParticles(dt, now) {
    candleAcc += dt * CANDLE_PARTICLE_RATE * flames.length;
    windowAcc += dt * WINDOW_PARTICLE_RATE;
    while (candleAcc >= 1) { spawnCandle(); candleAcc--; }
    while (windowAcc >= 1) { spawnWindow(); windowAcc--; }

    ctx.clearRect(0, 0, cw, ch);
    parts = parts.filter(p => (p.life += dt) < p.max);
    for (const p of parts) {
      p.x += (p.vx + Math.sin(now * 0.5 + p.ph) * 1.2) * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const env = Math.sin(Math.PI * k);               // fade in and out
      const alpha = p.a * env * (p.kind === 'mote' ? 0.8 + 0.2 * Math.sin(now * 0.8 + p.ph) : 1);
      const x = p.x * scale, y = p.y * scale, r = p.r * Math.max(scale, 0.6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      if (p.kind === 'ember') { g.addColorStop(0, `rgba(255,190,110,${alpha})`); g.addColorStop(1, 'rgba(255,150,60,0)'); }
      else                    { g.addColorStop(0, `rgba(205,225,255,${alpha})`); g.addColorStop(1, 'rgba(160,190,255,0)'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, 6.2832); ctx.fill();
    }
  }

  // ---------- Main loop ----------
  let last = performance.now(), running = true;
  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const now = t / 1000;
    const draught = 0.04 * Math.sin(now * 0.9) + 0.03 * Math.sin(now * 2.3 + 1);
    // slow pendulum: main swing plus a smaller, offset second wave so it never looks mechanical
    const w = 2 * Math.PI / CHANDELIER.period;
    swingAngle = CHANDELIER.swingDeg * (Math.sin(now * w) + 0.3 * Math.sin(now * w * 1.7 + 1.3)) / 1.3;
    swing.style.transform = `rotate(${swingAngle.toFixed(4)}deg)`;
    for (const l of lights) {
      if (l.swing) {
        const [sx, sy] = swung(l.x, l.y, swingAngle);
        l.el.style.left = pc(sx, W);
        l.el.style.top = pc(sy, H);
      }
      const v = flicker(l, dt, now, draught);
      l.el.style.opacity = Math.min(1, v).toFixed(3);
      l.el.style.transform = `translate(-50%,-50%) scale(${(0.92 + 0.1 * v).toFixed(3)})`;
    }
    stepParticles(dt, now);
    requestAnimationFrame(frame);
  }

  if (reduce) {
    lights.forEach(l => { l.el.style.opacity = 0.85; });   // static glow, no motion
  } else {
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) { last = performance.now(); requestAnimationFrame(frame); }
    });
  }
})();
