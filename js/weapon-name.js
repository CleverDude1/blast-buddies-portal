// topWeaponId -> weapon name. The name must match the image file in images/weapons (e.g. images/weapons/Assault.png).
// Shared by weapons.html, daily.html (rankings) and statistics.js. Ids and names confirmed from the game catalog.
window.BB_WEAPONS = {
  1: 'Assault',
  2: 'Burst',
  3: 'Shotgun',
  4: 'SMG',      // in game: SMG
  5: 'LMG',         // in game: LMG
  6: 'Sniper',
  7: 'Pistol',
  8: 'Revolver',
  9: 'Ray Gun',      // in game: Ray Gun
  10: 'Energy Pistole',     // in game: Energy Pistol
  11: 'Spectre',     // in game: Spectre
  12: 'Thompson',   // in game: Tommy
  13: 'Flare',
  14: 'Snare Gun',      // in game: Snare Gun
  15: 'Bow',
  101: 'Knife',     // not in the catalog (melee)
};

// Names as shown in the game, for display. Falls back to the image name when an id is not listed.
window.BB_WEAPON_LABELS = {
  4: 'SMG',
  5: 'LMG',
  9: 'Ray Gun',
  10: 'Energy Pistol',
  11: 'Spectre',
  12: 'Tommy',
  14: 'Snare Gun',
};
