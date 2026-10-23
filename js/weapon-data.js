// Weapon stats from the game catalog, stored offline (no API needed). Keyed by IMAGE name (images/weapons/<key>.png).
//   name      = in-game name          category = 'Primary' | 'Secondary'
//   rarity    = 0-3 (higher = rarer)  ranges   = [[up-to distance, damage per hit], ...]  (10000 = no falloff limit)
//   crit      = headshot multiplier   limb     = limb-shot multiplier
//   movement  = movement speed multiplier while holding it
//   fireRate  = shots per second (as published), reload = seconds, mag = magazine size, pellets = per shot (shotgun)
// Grenades and the Knife are not in the catalog.
window.BB_WEAPON_STATS = {
  Assault:  { id: 1,  name: 'Assault',       category: 'Primary',   rarity: 0, crit: 1.25, limb: 0.85, movement: 0.925, fireRate: 10,   reload: 1.1,  mag: 30,  scope: false, ranges: [[35, 16], [55, 15], [90, 12]] },
  Burst:    { id: 2,  name: 'Burst',         category: 'Primary',   rarity: 0, crit: 1.35, limb: 0.85, movement: 0.895, fireRate: 1.5,  reload: 1.1,  mag: 21,  scope: false, ranges: [[30, 25], [60, 22], [90, 16], [120, 12]] },
  Shotgun:  { id: 3,  name: 'Shotgun',       category: 'Primary',   rarity: 1, crit: 1.15, limb: 0.85, movement: 1.125, fireRate: 2,    reload: 1,    mag: 2,   scope: false, pellets: 6, ranges: [[8, 16], [14, 9], [20, 5]] },
  'MAC-10': { id: 4,  name: 'SMG',           category: 'Primary',   rarity: 0, crit: 1.2,  limb: 0.85, movement: 1.08,  fireRate: 12,   reload: 0.9,  mag: 24,  scope: false, ranges: [[8, 15], [16, 11], [25, 7], [40, 5]] },
  Lmg:      { id: 5,  name: 'LMG',           category: 'Primary',   rarity: 1, crit: 1.35, limb: 0.85, movement: 0.85,  fireRate: 5,    reload: 1.6,  mag: 60,  scope: false, ranges: [[30, 25], [55, 22], [80, 20], [120, 17]] },
  Sniper:   { id: 6,  name: 'Sniper',        category: 'Primary',   rarity: 2, crit: 2,    limb: 0.85, movement: 0.85,  fireRate: 0.85, reload: 1.2,  mag: 5,   scope: true,  ranges: [[200, 75]] },
  Pistol:   { id: 7,  name: 'Pistol',        category: 'Secondary', rarity: 0, crit: 1.25, limb: 0.85, movement: 1.15,  fireRate: 7,    reload: 1,    mag: 12,  scope: false, ranges: [[15, 17], [25, 14], [35, 11]] },
  Revolver: { id: 8,  name: 'Revolver',      category: 'Secondary', rarity: 1, crit: 1.5,  limb: 0.85, movement: 1.15,  fireRate: 4,    reload: 0.9,  mag: 6,   scope: false, ranges: [[20, 28], [30, 22], [40, 17]] },
  RayGun:   { id: 9,  name: 'Ray Gun',       category: 'Secondary', rarity: 3, crit: 1.5,  limb: 0.85, movement: 1.1,   fireRate: 1.5,  reload: 0.75, mag: 100, scope: false, ranges: [[10000, 50]] },
  Energy:   { id: 10, name: 'Energy Pistol', category: 'Secondary', rarity: 3, crit: 1.6,  limb: 0.85, movement: 1.15,  fireRate: 5,    reload: 0.9,  mag: 160, scope: false, ranges: [[10, 26], [20, 18], [30, 12]] },
  'UMP-45': { id: 11, name: 'Spectre',       category: 'Primary',   rarity: 2, crit: 1.2,  limb: 0.85, movement: 1.05,  fireRate: 8,    reload: 1,    mag: 30,  scope: false, ranges: [[15, 17], [25, 22], [35, 17], [55, 15]] },
  Thompson: { id: 12, name: 'Tommy',         category: 'Primary',   rarity: 3, crit: 1.3,  limb: 0.85, movement: 0.85,  fireRate: 8,    reload: 1.2,  mag: 40,  scope: false, ranges: [[15, 20], [35, 16], [60, 13], [90, 10]] },
  Flare:    { id: 13, name: 'Flare',         category: 'Secondary', rarity: 2, crit: 1.1,  limb: 0.9,  movement: 1.05,  fireRate: 1.2,  reload: 1.5,  mag: 3,   scope: false, ranges: [[12, 65], [24, 45], [36, 35]] },
  Snare:    { id: 14, name: 'Snare Gun',     category: 'Secondary', rarity: 1, crit: 1.25, limb: 0.85, movement: 1.15,  fireRate: 5,    reload: 1,    mag: 8,   scope: false, ranges: [[15, 12], [25, 9], [35, 7]] },
  Bow:      { id: 15, name: 'Bow',           category: 'Primary',   rarity: 2, crit: 1.9,  limb: 0.8,  movement: 1.05,  fireRate: 1.1,  reload: 0,    mag: 30,  scope: false, ranges: [[35, 55], [70, 50], [100, 35]] },
};
