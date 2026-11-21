// Costa Verde tuning: every number and colour lives here, in one place.
// The world is a flat x/z plane with y as height; no rule below depends on
// the screen size, the renderer, or the frame rate.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The city: a square grid of blocks separated by roads. size is metres. */
export const CITY = {
  size: 480,
  blocks: 6,
  roadWidth: 12,
  sidewalkWidth: 3,
  /** How many buildings each block interior may hold (1 or 2, rolled at build). */
  maxBuildingsPerBlock: 2,
  /** Half the size, for clamping positions inside the map. */
  get half() {
    return this.size / 2;
  },
};

/** On-foot player tuning. Speeds are metres per second. */
export const PLAYER = {
  walkSpeed: 4.2,
  runSpeed: 7.5,
  health: 100,
  radius: 0.9,
  /** How close the player must be to enter a car or pick a mission target up. */
  interactRadius: 3.2,
  /** Punch range and damage; punch cooldown in seconds. */
  punchRange: 2.2,
  punchDamage: 25,
  punchCooldown: 0.45,
  /** Gun: a short-range pistol with a small magazine. */
  gunRange: 28,
  gunDamage: 34,
  gunCooldown: 0.35,
  gunAmmoMax: 12,
  startAmmo: 6,
};

/** Driving tuning. */
export const CAR = {
  accel: 14,
  maxSpeed: 34,
  reverseSpeed: 10,
  /** Steering rate, radians per second at full lock (scaled down at speed). */
  turn: 2.1,
  brake: 30,
  /** How much speed a bump into a building or another car keeps. */
  crashKeep: 0.35,
  /** Traffic cars cruise a little slower than the player's top speed. */
  trafficSpeed: 11,
  trafficTurnChance: 0.35,
};

/** Police tuning. */
export const POLICE = {
  chaseSpeed: 30,
  bustRadius: 3.5,
  /** Cops appear this far from the player, off-screen in spirit. */
  spawnRadius: 55,
  /** A cop farther than this is teleported back to the spawn ring. */
  despawnRadius: 130,
  /** One cop per wanted star, capped here. */
  maxCops: 4,
  /** Touch damage per second while a cop car is grinding against the player. */
  ramDamage: 18,
  /** Cash fine taken on a bust. */
  bustFine: 120,
};

/** Wanted level: 0 to 5 stars. */
export const WANTED = {
  levels: 5,
  /** Stars added per crime (stealing a driven car, hitting a pedestrian). */
  heatPerCrime: 1,
  /** Stars added for punching or shooting a cop. */
  heatPerCopCrime: 2,
  /** Seconds with no crime and no cop nearby before one star cools off. */
  coolDownSeconds: 22,
  /** Distance inside which a cop counts as "nearby" for cooling purposes. */
  coolDownCopRange: 45,
};

/** Mission tuning. */
export const MISSIONS = {
  /** Radius in metres for "arrive at the target" checks. */
  arriveRadius: 6,
  /** Seconds allowed for a timed escape leg before it fails. */
  escapeTimeLimit: 75,
  /** Story chain: each entry is one mission, in order. */
  story: [
    {
      id: 'm0',
      type: 'taxi',
      title: "Dana's Back",
      text: 'Dana just got out. Pick her up at the north docks and bring her to the safehouse.',
      reward: 100,
    },
    {
      id: 'm1',
      type: 'delivery',
      title: 'First Drop',
      text: 'Dana needs a parcel at the north docks. Take it there, on foot or by car.',
      reward: 150,
    },
    {
      id: 'm2',
      type: 'taxi',
      title: 'Fare Game',
      text: 'A tourist is waiting at the plaza. Pick them up and drive them to the beach hotel.',
      reward: 200,
    },
    {
      id: 'm3',
      type: 'vigilante',
      title: 'Street Justice',
      text: 'A mugger is shaking down stalls near the market. Put him down.',
      reward: 250,
    },
    {
      id: 'm4',
      type: 'escape',
      title: 'Heat Run',
      text: 'The parcel was hot. Lose the heat: reach the safehouse with two stars on you.',
      reward: 300,
    },
    {
      id: 'm5',
      type: 'delivery',
      title: 'The Last Package',
      text: 'One last run, to the lighthouse at the south point. Finish the job.',
      reward: 500,
    },
  ],
};

/** Camera defaults for the renderer (world only hands the numbers over). */
export const CAMERA = {
  followDistance: 14,
  followHeight: 9,
  lookAhead: 6,
  driveDistance: 18,
  driveHeight: 10,
  fov: 60,
};

/** Palette and car colours. Colours are hex numbers for three.js. */
export const COLORS = {
  sky: 0x87b5d6,
  sun: 0xfff2cc,
  ground: 0x3d3d3d,
  road: 0x2b2b2e,
  sidewalk: 0x8a8a86,
  building: [0xd8c9a3, 0xb7c4d1, 0xd1a3a3, 0xa8c6a0, 0xc9b8d1],
  player: 0x2e86de,
  playerShirt: 0xe74c3c,
  ped: [0xf2c94c, 0x7fb069, 0xe07a5f, 0x81b29a, 0xf4a261],
  traffic: [0xc0392b, 0x2980b9, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0x16a085],
  police: 0x1a1a2e,
  policeLight: 0x2e6bff,
  target: 0xffd32a,
  safehouse: 0x2ed573,
};

/** Where the best score and mission progress are kept between visits (this browser only). */
export const BEST_KEY = 'gta6-01-best';
export const SAVE_KEY = 'gta6-01-save';
