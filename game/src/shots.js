// The screenshot scenes behind ?shot=start|play|win|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by an
// autopilot, so the frame is what a short game really looks like and the same
// seed always gives the same frame.
//
// The city is a grid of solid buildings, so the pilot navigates by roads, not
// straight lines: it follows road lines to the intersection nearest the target
// and only cuts across a block for the final few metres (on foot when the
// target sits inside a block). On foot it only chases parked cars — a traffic
// car drives faster than the player walks and can never be caught.
import { CITY, STEP } from './config.js';
import {
  EVENT_BUSTED,
  EVENT_OVER,
  EVENT_WIN,
  step,
} from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

// The ACTION_* bits, as input.js documents them. Kept local so this file never
// fails to load if input.js is mid-rewrite (input.js needs window and cannot
// even be imported in Node).
const ACTION_INTERACT = 8;
const ACTION_ATTACK = 16;

const START_SECONDS = 5;
const PLAY_SECONDS = 40;
const END_LIMIT_SECONDS = 600;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function activeMission(state) {
  if (!state.missions || !state.missions.list) return null;
  return state.missions.list.find((m) => m.id === state.missions.activeId) || null;
}

// Road centre lines across the city, same formula world.js uses.
function roadLines() {
  const lines = [];
  const pitch = CITY.size / CITY.blocks;
  for (let i = 0; i <= CITY.blocks; i += 1) lines.push(-CITY.size / 2 + i * pitch);
  return lines;
}
const LINES = roadLines();

function nearestLine(value) {
  let best = LINES[0];
  for (const line of LINES) {
    if (Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

/** True when a point sits on a road (within a few metres of a road line). */
function onRoad(x, z) {
  return Math.abs(x - nearestLine(x)) <= 8 || Math.abs(z - nearestLine(z)) <= 8;
}

/**
 * Next waypoint on a road-following route from (px, pz) to (tx, tz).
 * Close to the target, head straight at it; farther out, drive the grid:
 * along the current road to the intersection nearest the target, then turn.
 */
function roadWaypoint(px, pz, tx, tz) {
  const dist = Math.hypot(tx - px, tz - pz);
  if (dist < 25) return { x: tx, z: tz };
  const gx = nearestLine(tx);
  const gz = nearestLine(tz);
  // Already at the intersection nearest the target: cut straight to it
  // instead of chasing an unreachable waypoint on the map edge. (The edge
  // roads sit at ±240 but movement clamps at ±238, so the margin has to
  // cover that 2 m gap plus the 8 m road tolerance.)
  if (Math.hypot(px - gx, pz - gz) < 14) return { x: tx, z: tz };
  if (Math.abs(px - gx) > 8 && Math.abs(pz - gz) > 8) {
    // Need to move on both axes: run along the current road to the
    // intersection nearest the target, then turn there.
    if (Math.abs(pz - nearestLine(pz)) <= Math.abs(px - nearestLine(px))) return { x: gx, z: nearestLine(pz) };
    return { x: nearestLine(px), z: gz };
  }
  if (Math.abs(px - gx) > 8) return { x: gx, z: pz };
  return { x: px, z: gz };
}

function nearestParkedCar(state, x, z) {
  let bestCar = null;
  let bestDist = Infinity;
  for (const car of state.cars || []) {
    if (car.kind !== 'parked') continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestCar = car;
    }
  }
  return { car: bestCar, dist: bestDist };
}

function nearestPolice(state, x, z) {
  let bestCop = null;
  let bestDist = Infinity;
  for (const cop of state.police || []) {
    const d = Math.hypot(cop.x - x, cop.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestCop = cop;
    }
  }
  return { cop: bestCop, dist: bestDist };
}

function nearestPedAny(state, x, z, maxDist) {
  let bestPed = null;
  let bestDist = maxDist;
  for (const ped of state.peds || []) {
    if (!ped.active || ped.state === 'down') continue;
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestPed = ped;
    }
  }
  return { ped: bestPed, dist: bestDist };
}

function nearestHostile(state, x, z) {
  let bestPed = null;
  let bestDist = Infinity;
  for (const ped of state.peds || []) {
    if (!ped.active || !ped.hostile || ped.state === 'down') continue;
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestPed = ped;
    }
  }
  return { ped: bestPed, dist: bestDist };
}

/**
 * The autopilot, with a little memory: if it barely moves for 1.5 s while
 * trying to drive somewhere, it is wedged on a building, so it reverses
 * out (car) or turns away (on foot) for a moment.
 */
function createPilot() {
  let checkX = 0;
  let checkZ = 0;
  let checkFrames = 0;
  let unstuckFrames = 0;
  let lastTurn = 0;
  // After a deliberate exit (off-road target, or the vigilante job), the pilot
  // walks to the job and must NOT instantly re-enter the car it just left:
  // exiting puts the player 3 m from the car, inside the 3.2 m interact
  // radius, so without this the pilot would flicker in and out forever.
  let walkMission = null;

  return function autopilot(state, careful) {
    const p = state.player;
    const mission = activeMission(state);
    if (walkMission !== null && (!mission || mission.id !== walkMission)) walkMission = null;
    let actions = 0;
    let tx = p.x;
    let tz = p.z;

    if (mission && mission.type === 'vigilante') {
      const mugger = nearestHostile(state, p.x, p.z);
      if (mugger.ped) {
        tx = mugger.ped.x;
        tz = mugger.ped.z;
        if (p.onFoot && mugger.dist < 26) actions |= ACTION_ATTACK;
      } else if (mission.target) {
        tx = mission.target.x;
        tz = mission.target.z;
      }
      // Attacks only work on foot: get out of the car near the market.
      if (!p.onFoot && Math.hypot(tx - p.x, tz - p.z) < 10) {
        actions |= ACTION_INTERACT;
        walkMission = mission.id;
      }
    } else if (p.onFoot) {
      const near = nearestParkedCar(state, p.x, p.z);
      if (walkMission !== null) {
        // Walking this job out: ignore cars until the mission changes.
        if (mission && mission.target) {
          tx = mission.target.x;
          tz = mission.target.z;
        }
      } else if (!careful && (p.wanted || 0) < 3) {
        // Careless driver: pick a fight first. Punching a pedestrian is a
        // crime, so a few swings bring the police — and the end scene needs
        // the heat. Punching needs no aim (unlike the gun), so any ped in
        // range is a valid target.
        const ped = nearestPedAny(state, p.x, p.z, 20);
        if (ped.ped && ped.dist < 2.2) {
          actions |= ACTION_ATTACK;
        } else if (ped.ped) {
          tx = ped.ped.x;
          tz = ped.ped.z;
        } else if (near.car && near.dist < 3.2) {
          actions |= ACTION_INTERACT;
        } else if (near.car && near.dist < 60) {
          tx = near.car.x;
          tz = near.car.z;
        } else if (mission && mission.target) {
          tx = mission.target.x;
          tz = mission.target.z;
        }
      } else if (near.car && near.dist < 3.2) {
        actions |= ACTION_INTERACT;
      } else if (near.car && near.dist < 60) {
        tx = near.car.x;
        tz = near.car.z;
      } else if (mission && mission.target) {
        tx = mission.target.x;
        tz = mission.target.z;
      }
    } else if (mission && mission.target) {
      tx = mission.target.x;
      tz = mission.target.z;
    }

    const distToTarget = Math.hypot(tx - p.x, tz - p.z);
    // A target inside a block cannot be driven to: stop the car at the road
    // and walk the last stretch (and stay out until the job changes).
    if (!p.onFoot && distToTarget < 40 && !onRoad(tx, tz)) {
      actions |= ACTION_INTERACT;
      if (mission) walkMission = mission.id;
    }

    const wp = roadWaypoint(p.x, p.z, tx, tz);
    let dx = wp.x - p.x;
    let dz = wp.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;

    if (careful && !p.onFoot) {
      const near = nearestPolice(state, p.x, p.z);
      if (near.cop && near.dist < 30) {
        // Blend in a strong push directly away from the nearest police car.
        const ax = (p.x - near.cop.x) / near.dist;
        const az = (p.z - near.cop.z) / near.dist;
        const w = (30 - near.dist) / 30;
        const bx = dx + ax * w * 1.6;
        const bz = dz + az * w * 1.6;
        const bl = Math.hypot(bx, bz) || 1;
        dx = bx / bl;
        dz = bz / bl;
      }
    }

    const desired = Math.atan2(dx, dz);
    const diff = wrapAngle(desired - (p.heading || 0));
    const turn = clamp(diff * 1.6, -1, 1);
    lastTurn = turn;
    let input = {
      x: turn,
      y: Math.abs(diff) < 2.6 ? 1 : 0.35,
      brake: careful && distToTarget < 6 && !p.onFoot,
      boost: distToTarget > 25,
    };

    // Stuck detection: barely moved in 90 frames (1.5 s) while pushing on.
    checkFrames += 1;
    if (checkFrames === 1) {
      checkX = p.x;
      checkZ = p.z;
    } else if (checkFrames >= 90) {
      const moved = Math.hypot(p.x - checkX, p.z - checkZ);
      if (moved < 0.5 && distToTarget > 8) unstuckFrames = 48;
      checkFrames = 0;
    }
    if (unstuckFrames > 0) {
      unstuckFrames -= 1;
      if (p.onFoot) input = { x: 1, y: 0.5, brake: false, boost: false };
      else input = { x: -lastTurn, y: -1, brake: false, boost: false };
    }
    return { input, actions };
  };
}

function allMissionsDone(state) {
  const list = (state.missions && state.missions.list) || [];
  return list.length > 0 && list.every((m) => m.state === 'done');
}

/**
 * Set `world` (a fresh state from createWorld) to the named scene (start,
 * play, win or end; any other name is start) and return the screen to draw
 * over it and the best score to show.
 */
export function stageShot(name, world) {
  if (name !== 'play' && name !== 'win' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) {
      step(world, STEP, null, 0);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }

  const careful = name !== 'end';
  const limit = name === 'play' ? PLAY_SECONDS : END_LIMIT_SECONDS;
  const autopilot = createPilot();
  let won = false;
  let over = false;
  for (let i = 0; i < limit / STEP; i += 1) {
    const drive = autopilot(world, careful);
    const events = step(world, STEP, drive.input, drive.actions) || 0;
    if (events & EVENT_WIN || world.won || allMissionsDone(world)) {
      won = true;
      break;
    }
    if (events & EVENT_OVER || world.over) {
      over = true;
      break;
    }
    // A bust just fines the driver and respawns them; the end scene keeps
    // driving carelessly until health runs out or the limit hits.
  }
  const score = world.score || 0;
  if (won) return { screen: SCREEN_WIN, best: score };
  if (over) return { screen: SCREEN_OVER, best: score };
  return { screen: SCREEN_PLAY, best: score };
}
