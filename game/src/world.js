// Costa Verde: the whole game as pure logic. No DOM, no three.js, no
// browser globals except a guarded localStorage for saves, so this file
// imports and runs in plain Node for logic tests.
//
// The world is an x/z plane with y as height. The city is a grid of blocks
// separated by roads; traffic drives the roads, pedestrians walk the
// sidewalks, police chase the player, and a five-mission story chain pays
// cash. step() advances one fixed step and returns what happened as bit
// flags, so the caller can react without the world knowing about screens
// or sound.
//
// step() input shape: { x, y, brake, boost } from input.keyVector()
// (x: left/right steer, y: forward/back), or null for no input.
// step() actions shape: ACTION_* bit flags from input.takeActions().

import {
  BEST_KEY,
  CAMERA,
  CAR,
  CITY,
  COLORS,
  MISSIONS,
  PLAYER,
  POLICE,
  SAVE_KEY,
  WANTED,
} from './config.js';

export const EVENT_PICKUP = 1;
export const EVENT_DELIVER = 2;
export const EVENT_HIT = 4;
export const EVENT_WANTED_UP = 8;
export const EVENT_BUSTED = 16;
export const EVENT_MISSION_DONE = 32;
export const EVENT_WIN = 64;
export const EVENT_OVER = 128;

// Re-export the camera defaults so the renderer can read them from here.
export { CAMERA };

const TAU = Math.PI * 2;
const TRAFFIC_COUNT = 10;
const PARKED_COUNT = 8;
const PED_COUNT = 14;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Heading convention: forward = (sin(heading), cos(heading)) in (x, z). */
function forwardX(heading) {
  return Math.sin(heading);
}
function forwardZ(heading) {
  return Math.cos(heading);
}

/** Road centre lines across the city, one per grid line. */
function roadLines() {
  const lines = [];
  const pitch = CITY.size / CITY.blocks;
  for (let i = 0; i <= CITY.blocks; i += 1) {
    lines.push(-CITY.size / 2 + i * pitch);
  }
  return lines;
}

function nearestLine(lines, value) {
  let best = lines[0];
  for (const line of lines) {
    if (Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

function pickSpot(lines) {
  // Named places the story uses, all on roads so the player can reach them.
  const half = CITY.size / 2;
  return {
    docks: { x: 0, z: -half + 18 },
    plaza: { x: 0, z: 0 },
    market: { x: half - 38, z: 0 },
    safehouse: { x: -half + 28, z: -half + 28 },
    lighthouse: { x: 0, z: half - 18 },
    beachHotel: { x: half - 28, z: half - 28 },
    spawn: { x: 0, z: lines[4] },
  };
}

function buildCity(random) {
  const lines = roadLines();
  const buildings = [];
  const inset = CITY.roadWidth / 2 + 2;
  for (let i = 0; i < CITY.blocks; i += 1) {
    for (let j = 0; j < CITY.blocks; j += 1) {
      const x0 = lines[i] + inset;
      const x1 = lines[i + 1] - inset;
      const z0 = lines[j] + inset;
      const z1 = lines[j + 1] - inset;
      const two = random() < 0.4;
      const slots = two
        ? [
            { x0, x1: x0 + (x1 - x0) / 2 - 3, z0, z1 },
            { x0: x0 + (x1 - x0) / 2 + 3, x1, z0, z1 },
          ]
        : [{ x0, x1, z0, z1 }];
      for (const slot of slots) {
        const w = 18 + random() * Math.min(26, slot.x1 - slot.x0 - 18);
        const d = 18 + random() * Math.min(26, slot.z1 - slot.z0 - 18);
        const cx = slot.x0 + (slot.x1 - slot.x0) / 2 + (random() - 0.5) * 6;
        const cz = slot.z0 + (slot.z1 - slot.z0) / 2 + (random() - 0.5) * 6;
        buildings.push({
          x: cx,
          z: cz,
          w,
          d,
          h: 12 + random() * 28,
          color: COLORS.building[Math.floor(random() * COLORS.building.length)],
        });
      }
    }
  }
  return { lines, buildings };
}

function hitsBuilding(city, x, z, radius) {
  for (const b of city.buildings) {
    if (
      x > b.x - b.w / 2 - radius &&
      x < b.x + b.w / 2 + radius &&
      z > b.z - b.d / 2 - radius &&
      z < b.z + b.d / 2 + radius
    ) {
      return true;
    }
  }
  return false;
}

/** Move (x, z) with building collision, sliding along one axis at a time. */
function moveWithCollision(city, pos, dx, dz, radius) {
  const half = CITY.size / 2 - 2;
  let nx = clamp(pos.x + dx, -half, half);
  let nz = clamp(pos.z + dz, -half, half);
  if (!hitsBuilding(city, nx, pos.z, radius)) pos.x = nx;
  if (!hitsBuilding(city, pos.x, nz, radius)) pos.z = nz;
}

function loadSave() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export function saveProgress(state) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        best: state.best,
        cash: state.player.cash,
        done: state.missions.list.filter((m) => m.state === 'done').map((m) => m.id),
      }),
    );
    return true;
  } catch (err) {
    return false;
  }
}

function loadBest() {
  const save = loadSave();
  if (save && typeof save.best === 'number') return save.best;
  try {
    if (typeof localStorage === 'undefined') return 0;
    return Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  } catch (err) {
    return 0;
  }
}

export function createWorld(random, options = {}) {
  const city = buildCity(random);
  const spots = pickSpot(city.lines);
  // A fresh world (a new game from the title screen, or a staged screenshot
  // scene) never restores an old save: without this, winning once would leave
  // every later "new game" with the whole story already done.
  const saved = options.fresh ? null : loadSave();

  let nextId = 1;
  const id = () => nextId++;

  const player = {
    x: spots.spawn.x,
    z: spots.spawn.z,
    heading: 0,
    speed: 0,
    onFoot: true,
    carId: null,
    health: PLAYER.health,
    cash: 0,
    wanted: 0,
    ammo: PLAYER.startAmmo,
    hasGun: true,
    punchTimer: 0,
    gunTimer: 0,
    attackTimer: 0,
    spawn: { x: spots.spawn.x, z: spots.spawn.z },
  };

  const cars = [];
  // Parked cars along road edges.
  for (let i = 0; i < PARKED_COUNT; i += 1) {
    const line = city.lines[1 + Math.floor(random() * (CITY.blocks - 1))];
    const along = city.lines[1 + Math.floor(random() * (CITY.blocks - 1))];
    const horizontal = random() < 0.5;
    cars.push({
      id: id(),
      x: horizontal ? along : line + (random() < 0.5 ? -1 : 1) * (CITY.roadWidth / 2 - 2),
      z: horizontal ? line + (random() < 0.5 ? -1 : 1) * (CITY.roadWidth / 2 - 2) : along,
      heading: horizontal ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : random() < 0.5 ? 0 : Math.PI,
      speed: 0,
      color: COLORS.traffic[Math.floor(random() * COLORS.traffic.length)],
      kind: 'parked',
      driver: false,
    });
  }
  // Traffic cars driving the roads.
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const horizontal = random() < 0.5;
    const line = city.lines[Math.floor(random() * city.lines.length)];
    const dir = random() < 0.5 ? 1 : -1;
    const along = (random() * 2 - 1) * (CITY.size / 2 - 20);
    cars.push({
      id: id(),
      x: horizontal ? along : line + dir * 2.5,
      z: horizontal ? line + dir * 2.5 : along,
      heading: horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI,
      speed: CAR.trafficSpeed * (0.8 + random() * 0.4),
      color: COLORS.traffic[Math.floor(random() * COLORS.traffic.length)],
      kind: 'traffic',
      driver: true,
      axis: horizontal ? 'x' : 'z',
      road: line,
      dir,
      turnTimer: 1 + random() * 3,
    });
  }

  const peds = [];
  for (let i = 0; i < PED_COUNT; i += 1) {
    const horizontal = random() < 0.5;
    const line = city.lines[Math.floor(random() * city.lines.length)];
    const side = random() < 0.5 ? 1 : -1;
    const along = (random() * 2 - 1) * (CITY.size / 2 - 20);
    peds.push({
      id: id(),
      x: horizontal ? along : line + side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2),
      z: horizontal ? line + side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2) : along,
      heading: horizontal ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : random() < 0.5 ? 0 : Math.PI,
      speed: 1 + random() * 0.8,
      health: 50,
      hostile: false,
      state: 'walk',
      color: COLORS.ped[Math.floor(random() * COLORS.ped.length)],
      axis: horizontal ? 'x' : 'z',
      road: line,
      side,
      dir: random() < 0.5 ? 1 : -1,
      turnTimer: 1 + random() * 3,
      fleeTimer: 0,
      downTimer: 0,
      active: true,
    });
  }

  const missions = {
    list: MISSIONS.story.map((m, index) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      text: m.text,
      target: missionTarget(m, spots),
      state: index === 0 ? 'active' : 'locked',
      reward: m.reward,
      phase: 0,
      timer: 0,
    })),
    activeId: MISSIONS.story[0].id,
  };

  const state = {
    time: 0,
    player,
    cars,
    peds,
    police: [],
    missions,
    score: 0,
    best: loadBest(),
    city,
    spots,
    over: false,
    won: false,
    crimeTimer: 0,
    failTimer: 0,
    // The seeded generator lives on the state so step() needs no extra arg.
    random,
  };

  // Restore a previous run's progress: finished missions stay done.
  if (saved && Array.isArray(saved.done)) {
    for (const m of missions.list) {
      if (saved.done.includes(m.id)) m.state = 'done';
    }
    const firstOpen = missions.list.find((m) => m.state !== 'done');
    if (firstOpen) {
      firstOpen.state = 'active';
      missions.activeId = firstOpen.id;
    } else {
      missions.activeId = null;
    }
    if (typeof saved.cash === 'number') player.cash = saved.cash;
  }

  return state;

  function missionTarget(m, s) {
    if (m.type === 'delivery' && m.id === 'm1') return { x: s.docks.x, z: s.docks.z };
    if (m.type === 'delivery') return { x: s.lighthouse.x, z: s.lighthouse.z };
    if (m.type === 'taxi') return { x: s.plaza.x, z: s.plaza.z };
    if (m.type === 'vigilante') return { x: s.market.x, z: s.market.z };
    if (m.type === 'escape') return { x: s.safehouse.x, z: s.safehouse.z };
    return { x: s.plaza.x, z: s.plaza.z };
  }
}

function activeMission(state) {
  if (!state.missions.activeId) return null;
  return state.missions.list.find((m) => m.id === state.missions.activeId) || null;
}

function addWanted(state, stars) {
  state.player.wanted = Math.min(WANTED.levels, state.player.wanted + stars);
  state.crimeTimer = 0;
}

function nearestCar(state, x, z, maxDist) {
  let bestCar = null;
  let bestD2 = maxDist * maxDist;
  for (const car of state.cars) {
    const d2 = dist2(x, z, car.x, car.z);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestCar = car;
    }
  }
  return bestCar;
}

function nearestPed(state, x, z, maxDist, hostileOnly) {
  let bestPed = null;
  let bestD2 = maxDist * maxDist;
  for (const ped of state.peds) {
    if (!ped.active) continue;
    if (hostileOnly && !ped.hostile) continue;
    const d2 = dist2(x, z, ped.x, ped.z);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestPed = ped;
    }
  }
  return bestPed;
}

function spawnCop(state, random) {
  const angle = random() * TAU;
  const p = state.player;
  const x = clamp(p.x + Math.cos(angle) * POLICE.spawnRadius, -CITY.size / 2 + 4, CITY.size / 2 - 4);
  const z = clamp(p.z + Math.sin(angle) * POLICE.spawnRadius, -CITY.size / 2 + 4, CITY.size / 2 - 4);
  state.police.push({
    id: 1000 + state.police.length + Math.floor(random() * 1000),
    x,
    z,
    heading: Math.atan2(p.x - x, p.z - z),
    speed: POLICE.chaseSpeed * 0.7,
    state: 'chase',
    health: 100,
  });
}

function enterCar(state, car) {
  const p = state.player;
  let events = 0;
  if (car.kind === 'police') return events; // Cop cars are locked.
  if (car.kind === 'traffic' && car.driver) {
    // Stealing a driven car is a crime, and the driver gets out and runs.
    addWanted(state, WANTED.heatPerCrime);
    events |= EVENT_WANTED_UP;
    car.driver = false;
    const driver = {
      id: 5000 + car.id,
      x: car.x + 2,
      z: car.z + 2,
      heading: 0,
      speed: 6,
      health: 50,
      hostile: false,
      state: 'flee',
      color: COLORS.ped[0],
      axis: 'x',
      road: car.z,
      side: 1,
      dir: 1,
      turnTimer: 2,
      fleeTimer: 5,
      downTimer: 0,
      active: true,
    };
    state.peds.push(driver);
  }
  car.kind = 'player';
  car.speed = 0;
  p.onFoot = false;
  p.carId = car.id;
  p.speed = 0;
  return events;
}

function exitCar(state) {
  const p = state.player;
  const car = state.cars.find((c) => c.id === p.carId);
  if (!car) {
    p.onFoot = true;
    p.carId = null;
    return;
  }
  car.kind = 'parked';
  car.speed = 0;
  p.x = car.x - forwardZ(car.heading) * 3;
  p.z = car.z + forwardX(car.heading) * 3;
  p.heading = car.heading;
  p.onFoot = true;
  p.carId = null;
  p.speed = 0;
}

function damagePed(state, ped, damage) {
  ped.health -= damage;
  if (ped.health <= 0) {
    ped.health = 0;
    ped.state = 'down';
    ped.downTimer = 6;
    ped.speed = 0;
  } else if (!ped.hostile) {
    ped.state = 'flee';
    ped.fleeTimer = 4;
    ped.speed = 6;
  }
}

function stepPlayer(state, dt, input, actions, random) {
  const p = state.player;
  let events = 0;
  if (p.punchTimer > 0) p.punchTimer -= dt;
  if (p.gunTimer > 0) p.gunTimer -= dt;
  if (p.attackTimer > 0) p.attackTimer -= dt;

  const ix = input ? input.x : 0;
  const iy = input ? input.y : 0;
  const brake = input ? !!input.brake : false;
  const boost = input ? !!input.boost : false;

  if (p.onFoot) {
    const speed = boost ? PLAYER.runSpeed : PLAYER.walkSpeed;
    p.heading += ix * 3.0 * dt;
    const move = iy * speed * dt;
    moveWithCollision(state.city, p, forwardX(p.heading) * move, forwardZ(p.heading) * move, PLAYER.radius);
    p.speed = Math.abs(move) / Math.max(dt, 1e-6);

    if (actions & 8) {
      // E on foot: nearest car wins, otherwise a nearby pedestrian gets a punch.
      const car = nearestCar(state, p.x, p.z, PLAYER.interactRadius);
      if (car) {
        events |= enterCar(state, car);
      }
    }
  } else {
    const car = state.cars.find((c) => c.id === p.carId);
    if (!car) {
      p.onFoot = true;
      p.carId = null;
    } else {
      if (iy > 0) car.speed += CAR.accel * (boost ? 1.4 : 1) * dt;
      else if (iy < 0) car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.accel * 0.6) * dt;
      else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);
      if (brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), CAR.brake * dt);
      car.speed = clamp(car.speed, -CAR.reverseSpeed, CAR.maxSpeed);
      const steer = ix * CAR.turn * dt * clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed < 0 ? -1 : 1);
      car.heading += steer;
      const dx = forwardX(car.heading) * car.speed * dt;
      const dz = forwardZ(car.heading) * car.speed * dt;
      const ox = car.x;
      const oz = car.z;
      moveWithCollision(state.city, car, dx, dz, 1.6);
      if ((car.x === ox && Math.abs(dx) > 0.01) || (car.z === oz && Math.abs(dz) > 0.01)) {
        car.speed *= CAR.crashKeep;
      }
      p.x = car.x;
      p.z = car.z;
      p.heading = car.heading;
      p.speed = car.speed;

      // Running over a pedestrian is a crime.
      for (const ped of state.peds) {
        if (!ped.active || ped.state === 'down') continue;
        if (dist2(car.x, car.z, ped.x, ped.z) < 2.0 * 2.0 && Math.abs(car.speed) > 2) {
          damagePed(state, ped, 100);
          addWanted(state, WANTED.heatPerCrime);
          events |= EVENT_HIT | EVENT_WANTED_UP;
        }
      }
      // Bumping traffic cars slows both down.
      for (const other of state.cars) {
        if (other === car || other.kind === 'player') continue;
        if (dist2(car.x, car.z, other.x, other.z) < 3.2 * 3.2) {
          car.speed *= 0.6;
          other.speed *= 0.6;
        }
      }

      if (actions & 8) exitCar(state);
    }
  }

  // Attack: F. Gun if it has ammo, otherwise fists.
  if ((actions & 16) && p.onFoot) {
    if (p.hasGun && p.ammo > 0 && p.gunTimer <= 0) {
      p.gunTimer = PLAYER.gunCooldown;
      p.ammo -= 1;
      // Nearest cop car in range and roughly ahead.
      let targetCop = null;
      let bestD2 = PLAYER.gunRange * PLAYER.gunRange;
      for (const cop of state.police) {
        const d2 = dist2(p.x, p.z, cop.x, cop.z);
        if (d2 >= bestD2) continue;
        const ang = Math.abs(angleDiff(Math.atan2(cop.x - p.x, cop.z - p.z), p.heading));
        if (ang > 0.6) continue;
        bestD2 = d2;
        targetCop = cop;
      }
      if (targetCop) {
        targetCop.health -= PLAYER.gunDamage;
        events |= EVENT_HIT;
        addWanted(state, WANTED.heatPerCopCrime);
        events |= EVENT_WANTED_UP;
        if (targetCop.health <= 0) {
          state.police = state.police.filter((c) => c !== targetCop);
          p.cash += 50;
          state.score += 50;
        }
      } else {
        const ped = nearestPed(state, p.x, p.z, PLAYER.gunRange, false);
        if (ped) {
          const ang = Math.abs(angleDiff(Math.atan2(ped.x - p.x, ped.z - p.z), p.heading));
          if (ang < 0.6) {
            damagePed(state, ped, PLAYER.gunDamage);
            events |= EVENT_HIT;
            if (!ped.hostile) {
              addWanted(state, WANTED.heatPerCrime);
              events |= EVENT_WANTED_UP;
            }
          }
        }
      }
    } else if (p.punchTimer <= 0) {
      p.punchTimer = PLAYER.punchCooldown;
      const ped = nearestPed(state, p.x, p.z, PLAYER.punchRange, false);
      if (ped) {
        damagePed(state, ped, PLAYER.punchDamage);
        events |= EVENT_HIT;
        if (!ped.hostile) {
          addWanted(state, WANTED.heatPerCrime);
          events |= EVENT_WANTED_UP;
        }
      }
    }
  }
  return events;
}

function stepTraffic(state, dt, random) {
  const lines = state.city.lines;
  for (const car of state.cars) {
    if (car.kind !== 'traffic') continue;
    car.turnTimer -= dt;
    const nearIntersection =
      Math.abs(car.x - nearestLine(lines, car.x)) < 1.2 ||
      Math.abs(car.z - nearestLine(lines, car.z)) < 1.2;
    if (car.turnTimer <= 0 && nearIntersection && random() < CAR.trafficTurnChance) {
      // Turn onto the cross street.
      car.turnTimer = 2 + random() * 3;
      const turnLeft = random() < 0.5;
      if (car.axis === 'x') {
        car.axis = 'z';
        car.road = nearestLine(lines, car.x);
        car.dir = turnLeft ? -1 : 1;
        car.x = car.road + car.dir * 2.5;
        car.heading = car.dir > 0 ? 0 : Math.PI;
      } else {
        car.axis = 'x';
        car.road = nearestLine(lines, car.z);
        car.dir = turnLeft ? -1 : 1;
        car.z = car.road + car.dir * 2.5;
        car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    if (car.axis === 'x') {
      car.x += car.dir * car.speed * dt;
      car.z = car.road + car.dir * 2.5;
      if (Math.abs(car.x) > CITY.size / 2 - 8) car.dir *= -1;
    } else {
      car.z += car.dir * car.speed * dt;
      car.x = car.road + car.dir * 2.5;
      if (Math.abs(car.z) > CITY.size / 2 - 8) car.dir *= -1;
    }
    car.heading = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : car.dir > 0 ? 0 : Math.PI;
  }
  // Gentle separation so traffic does not stack on one spot.
  for (let i = 0; i < state.cars.length; i += 1) {
    for (let j = i + 1; j < state.cars.length; j += 1) {
      const a = state.cars[i];
      const b = state.cars[j];
      if (a.kind !== 'traffic' || b.kind !== 'traffic') continue;
      if (dist2(a.x, a.z, b.x, b.z) < 3 * 3) {
        a.speed *= 0.98;
        b.speed = Math.min(b.speed * 1.02, CAR.trafficSpeed * 1.2);
      }
    }
  }
}

function stepPeds(state, dt, random) {
  const lines = state.city.lines;
  const p = state.player;
  for (const ped of state.peds) {
    if (!ped.active) continue;
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) ped.active = false;
      continue;
    }
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const away = Math.atan2(ped.x - p.x, ped.z - p.z);
      ped.heading = away;
      moveWithCollision(state.city, ped, forwardX(away) * ped.speed * dt, forwardZ(away) * ped.speed * dt, 0.8);
      if (ped.fleeTimer <= 0) {
        ped.state = 'walk';
        ped.speed = 1 + random() * 0.8;
      }
      continue;
    }
    if (ped.hostile) {
      // The mugger closes in on the player and swings when close.
      const d2 = dist2(ped.x, ped.z, p.x, p.z);
      if (d2 < 30 * 30 && p.onFoot) {
        const toward = Math.atan2(p.x - ped.x, p.z - ped.z);
        ped.heading = toward;
        if (d2 > 2.2 * 2.2) {
          moveWithCollision(state.city, ped, forwardX(toward) * 4.5 * dt, forwardZ(toward) * 4.5 * dt, 0.8);
        } else if (ped.attackTimer === undefined || ped.attackTimer <= 0) {
          ped.attackTimer = 0.8;
          p.health -= 8;
        }
      }
      if (ped.attackTimer !== undefined && ped.attackTimer > 0) ped.attackTimer -= dt;
      continue;
    }
    ped.turnTimer -= dt;
    const nearIntersection =
      Math.abs(ped.x - nearestLine(lines, ped.x)) < 1.2 ||
      Math.abs(ped.z - nearestLine(lines, ped.z)) < 1.2;
    if (ped.turnTimer <= 0 && nearIntersection && random() < 0.4) {
      ped.turnTimer = 2 + random() * 3;
      if (ped.axis === 'x') {
        ped.axis = 'z';
        ped.road = nearestLine(lines, ped.x);
        ped.side = random() < 0.5 ? 1 : -1;
        ped.dir = random() < 0.5 ? 1 : -1;
        ped.x = ped.road + ped.side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2);
      } else {
        ped.axis = 'x';
        ped.road = nearestLine(lines, ped.z);
        ped.side = random() < 0.5 ? 1 : -1;
        ped.dir = random() < 0.5 ? 1 : -1;
        ped.z = ped.road + ped.side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2);
      }
    }
    if (ped.axis === 'x') {
      ped.x = clamp(ped.x + ped.dir * ped.speed * dt, -CITY.size / 2 + 4, CITY.size / 2 - 4);
      ped.z = ped.road + ped.side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2);
      if (Math.abs(ped.x) > CITY.size / 2 - 6) ped.dir *= -1;
      ped.heading = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      ped.z = clamp(ped.z + ped.dir * ped.speed * dt, -CITY.size / 2 + 4, CITY.size / 2 - 4);
      ped.x = ped.road + ped.side * (CITY.roadWidth / 2 + CITY.sidewalkWidth / 2);
      if (Math.abs(ped.z) > CITY.size / 2 - 6) ped.dir *= -1;
      ped.heading = ped.dir > 0 ? 0 : Math.PI;
    }
  }
}

function stepPolice(state, dt, random) {
  const p = state.player;
  let events = 0;
  const want = Math.min(p.wanted, POLICE.maxCops);
  while (state.police.length < want) spawnCop(state, random);
  if (p.wanted === 0 && state.police.length > 0) {
    state.police.length = 0;
  }
  for (const cop of state.police) {
    const d2 = dist2(cop.x, cop.z, p.x, p.z);
    const dist = Math.sqrt(d2);
    if (dist > POLICE.despawnRadius) {
      const angle = random() * TAU;
      cop.x = clamp(p.x + Math.cos(angle) * POLICE.spawnRadius, -CITY.size / 2 + 4, CITY.size / 2 - 4);
      cop.z = clamp(p.z + Math.sin(angle) * POLICE.spawnRadius, -CITY.size / 2 + 4, CITY.size / 2 - 4);
      cop.speed = POLICE.chaseSpeed * 0.7;
      continue;
    }
    const targetHeading = Math.atan2(p.x - cop.x, p.z - cop.z);
    const turn = clamp(angleDiff(targetHeading, cop.heading), -2.4 * dt, 2.4 * dt);
    cop.heading += turn;
    // Cops creep up on a player on foot, and charge a player in a car.
    let targetSpeed = POLICE.chaseSpeed;
    if (p.onFoot && dist < 14) targetSpeed = 5;
    if (p.onFoot && dist < POLICE.bustRadius && cop.speed < 6) {
      // Busted: fined, dumped back at the spawn, heat gone.
      p.cash = Math.max(0, p.cash - POLICE.bustFine);
      p.wanted = 0;
      p.health = PLAYER.health;
      p.x = p.spawn.x;
      p.z = p.spawn.z;
      p.heading = 0;
      if (!p.onFoot) {
        const car = state.cars.find((c) => c.id === p.carId);
        if (car) {
          car.kind = 'parked';
          car.speed = 0;
        }
        p.onFoot = true;
        p.carId = null;
      }
      state.police.length = 0;
      events |= EVENT_BUSTED;
      return events;
    }
    cop.speed += clamp(targetSpeed - cop.speed, -20 * dt, 12 * dt);
    const ox = cop.x;
    const oz = cop.z;
    moveWithCollision(state.city, cop, forwardX(cop.heading) * cop.speed * dt, forwardZ(cop.heading) * cop.speed * dt, 1.6);
    if (cop.x === ox && cop.z === oz && cop.speed > 1) {
      // Stuck on a building corner: swing around it.
      cop.heading += 0.9 * dt * 10;
    }
    // Ramming the player's car hurts the player and slows the car.
    const afterD2 = dist2(cop.x, cop.z, p.x, p.z);
    if (afterD2 < 3.4 * 3.4) {
      p.health -= POLICE.ramDamage * dt;
      if (!p.onFoot) {
        const car = state.cars.find((c) => c.id === p.carId);
        if (car) car.speed *= 1 - 1.5 * dt;
      }
      events |= EVENT_HIT;
    }
  }
  return events;
}

function stepMissions(state, dt, random) {
  const p = state.player;
  let events = 0;
  const mission = activeMission(state);
  if (!mission) return events;

  if (mission.type === 'vigilante' && mission.phase === 0) {
    // Spawn the mugger once, at the market.
    mission.phase = 1;
    const mugger = {
      id: 9001,
      x: state.spots.market.x + 4,
      z: state.spots.market.z,
      heading: 0,
      speed: 4.5,
      health: 60,
      hostile: true,
      state: 'walk',
      color: 0x222222,
      axis: 'x',
      road: state.spots.market.z,
      side: 1,
      dir: 1,
      turnTimer: 2,
      fleeTimer: 0,
      downTimer: 0,
      active: true,
    };
    state.peds.push(mugger);
    mission.muggerId = mugger.id;
  }
  if (mission.type === 'vigilante' && mission.phase === 1) {
    const mugger = state.peds.find((ped) => ped.id === mission.muggerId);
    if (mugger) {
      mission.target = { x: mugger.x, z: mugger.z };
      if (mugger.state === 'down') {
        completeMission(state, mission);
        events |= EVENT_MISSION_DONE;
        return events;
      }
    }
  }
  if (mission.type === 'escape') {
    if (mission.phase === 0) {
      mission.phase = 1;
      mission.timer = MISSIONS.escapeTimeLimit;
      if (p.wanted < 2) addWanted(state, 2 - p.wanted);
    }
    mission.timer -= dt;
    if (mission.timer <= 0) {
      mission.state = 'failed';
      state.failTimer = 4;
      return events;
    }
    if (dist2(p.x, p.z, mission.target.x, mission.target.z) < MISSIONS.arriveRadius * MISSIONS.arriveRadius) {
      p.wanted = 0;
      state.police.length = 0;
      completeMission(state, mission);
      events |= EVENT_MISSION_DONE;
      return events;
    }
    return events;
  }
  if (mission.type === 'taxi') {
    if (mission.phase === 0) {
      if (dist2(p.x, p.z, mission.target.x, mission.target.z) < MISSIONS.arriveRadius * MISSIONS.arriveRadius) {
        mission.phase = 1;
        mission.target = { x: state.spots.beachHotel.x, z: state.spots.beachHotel.z };
        events |= EVENT_PICKUP;
      }
      return events;
    }
    if (dist2(p.x, p.z, mission.target.x, mission.target.z) < MISSIONS.arriveRadius * MISSIONS.arriveRadius) {
      completeMission(state, mission);
      events |= EVENT_DELIVER | EVENT_MISSION_DONE;
      return events;
    }
    return events;
  }
  // Delivery: just arrive at the target.
  if (dist2(p.x, p.z, mission.target.x, mission.target.z) < MISSIONS.arriveRadius * MISSIONS.arriveRadius) {
    completeMission(state, mission);
    events |= EVENT_DELIVER | EVENT_MISSION_DONE;
  }
  return events;
}

function completeMission(state, mission) {
  const p = state.player;
  mission.state = 'done';
  p.cash += mission.reward;
  state.score += mission.reward;
  p.ammo = Math.min(PLAYER.gunAmmoMax, p.ammo + 6);
  const next = state.missions.list.find((m) => m.state === 'locked');
  if (next) {
    next.state = 'active';
    state.missions.activeId = next.id;
  } else {
    state.missions.activeId = null;
    state.won = true;
  }
  if (state.score > state.best) {
    state.best = state.score;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(BEST_KEY, String(state.best));
    } catch (err) {
      // Private mode: best score just lives for this visit.
    }
  }
  saveProgress(state);
}

export function step(state, dt, input, actions) {
  if (state.over || state.won) return 0;
  const random = state.random;
  let events = 0;
  state.time += dt;
  state.crimeTimer += dt;

  // A failed escape leg retries itself after a short breather.
  if (state.failTimer > 0) {
    state.failTimer -= dt;
    if (state.failTimer <= 0) {
      const failed = state.missions.list.find((m) => m.state === 'failed');
      if (failed) {
        failed.state = 'active';
        failed.phase = 0;
        failed.timer = 0;
        state.missions.activeId = failed.id;
        state.player.wanted = 0;
        state.police.length = 0;
      }
    }
  }

  events |= stepPlayer(state, dt, input, actions || 0, random);
  stepTraffic(state, dt, random);
  stepPeds(state, dt, random);
  events |= stepPolice(state, dt, random);
  events |= stepMissions(state, dt, random);

  // Wanted cools off one star at a time when the player lies low.
  if (state.player.wanted > 0 && state.crimeTimer > WANTED.coolDownSeconds) {
    let nearCop = false;
    for (const cop of state.police) {
      if (dist2(cop.x, cop.z, state.player.x, state.player.z) < WANTED.coolDownCopRange * WANTED.coolDownCopRange) {
        nearCop = true;
        break;
      }
    }
    if (!nearCop) {
      state.player.wanted -= 1;
      state.crimeTimer = 0;
    }
  }

  if (state.player.health <= 0) {
    state.player.health = 0;
    state.over = true;
    events |= EVENT_OVER;
    saveProgress(state);
  }
  if (state.won) events |= EVENT_WIN;
  return events;
}
