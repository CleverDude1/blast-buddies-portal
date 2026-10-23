// Abilities from the game catalog, stored offline (no API needed).
// Image for each ability: images/abilities/<name>.png  (same name as below, e.g. "Pulse Scan.png")
//   cooldown / duration are in seconds, levelRequired = player level that unlocks it.
window.BB_ABILITIES = [
  { id: 1, name: 'Dash',        description: 'Burst forward in your movement direction',                              cooldown: 8,  duration: 0.2, levelRequired: 1, maxCharges: 2 },
  { id: 2, name: 'Grapple',     description: 'Launch a hook to pull yourself to surfaces',                            cooldown: 11, duration: 3,   levelRequired: 1, maxCharges: 1 },
  { id: 3, name: 'Shield',      description: 'Deploy a bubble shield that blocks bullets',                            cooldown: 14, duration: 5,   levelRequired: 1, maxCharges: 1 },
  { id: 5, name: 'Pulse Scan',  description: 'Reveal nearby enemies through walls',                                   cooldown: 18, duration: 3,   levelRequired: 5, maxCharges: 1 },
  { id: 4, name: 'Decoy',       description: 'Deploy a holographic decoy of yourself',                                cooldown: 16, duration: 5,   levelRequired: 6, maxCharges: 1 },
  { id: 7, name: 'Cloak',       description: 'Become nearly invisible for a short time',                              cooldown: 14, duration: 3,   levelRequired: 7, maxCharges: 1 },
  { id: 6, name: 'Ground Slam', description: 'Launch up then slam down dealing AoE damage',                           cooldown: 18, duration: 1.5, levelRequired: 8, maxCharges: 1 },
  { id: 8, name: 'Chrono Orb',  description: 'Drop a time-distortion field that slows enemies and speeds up allies',  cooldown: 20, duration: 10,  levelRequired: 9, maxCharges: 1 },
];
