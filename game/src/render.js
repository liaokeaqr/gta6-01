// Drawing only: the 3D city, the cars and people in it, the follow camera, and the
// DOM HUD (wanted stars, speed, cash, mission text, minimap). The world's state and
// the current screen go in; pixels and HUD text come out. Nothing here owns rules:
// positions, speeds and mission state all come from world.js through draw().
//
// The city geometry follows config.js: roads on the pitch size/blocks, and the
// buildings are the ones world.js built in state.city.buildings, so what you see
// is exactly what you can crash into.
import * as THREE from 'three';
import { CAMERA, CITY, COLORS } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_INTRO = 'intro';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

// Config values arrive from config.js; every read below falls back to a sane
// number so the renderer still stands up if a field is renamed or missing.
function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function col(value, fallback) {
  try {
    return new THREE.Color(value ?? fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

const CITY_SIZE = num(CITY && CITY.size, 480);
const BLOCKS = Math.max(3, Math.round(num(CITY && CITY.blocks, 6)));
const ROAD = num(CITY && CITY.roadWidth, 12);
const PITCH = CITY_SIZE / BLOCKS;
const HALF = CITY_SIZE / 2;

const CAM_WALK_DIST = num(CAMERA && CAMERA.followDistance, 14);
const CAM_WALK_HEIGHT = num(CAMERA && CAMERA.followHeight, 9);
const CAM_DRIVE_DIST = num(CAMERA && CAMERA.driveDistance, 18);
const CAM_DRIVE_HEIGHT = num(CAMERA && CAMERA.driveHeight, 10);
const CAM_LOOK_AHEAD = num(CAMERA && CAMERA.lookAhead, 6);
const CAM_FOV = num(CAMERA && CAMERA.fov, 60);

const MAX_CARS = 28;
const MAX_PEDS = 32;
const MAX_POLICE = 8;

const BUILDING_FALLBACK = [0xd8c9a3, 0xb7c4d1, 0xd1a3a3, 0xa8c6a0, 0xc9b8d1];
const BUILDING_COLORS = Array.isArray(COLORS && COLORS.building) && COLORS.building.length ? COLORS.building : BUILDING_FALLBACK;
const TRAFFIC_COLORS = Array.isArray(COLORS && COLORS.traffic) && COLORS.traffic.length ? COLORS.traffic : [0xc0392b, 0x2980b9, 0xf1c40f];
const PED_COLORS = Array.isArray(COLORS && COLORS.ped) && COLORS.ped.length ? COLORS.ped : [0xf2c94c, 0x7fb069, 0xe07a5f];

function makeBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  return mesh;
}

function makeCarMesh(bodyColor) {
  const group = new THREE.Group();
  const body = makeBox(2.1, 0.62, 4.4, bodyColor, 0, 0.55, 0);
  const cabin = makeBox(1.8, 0.55, 2.2, '#20242c', 0, 1.1, -0.2);
  const stripe = makeBox(2.12, 0.1, 0.5, '#f5f5f5', 0, 0.62, 1.2);
  group.add(body, cabin, stripe);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#14161a' });
  const wheels = [];
  for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  group.userData.wheels = wheels;
  group.userData.body = body;
  group.userData.bodyColor = bodyColor;
  return group;
}

function makePersonMesh(shirt, pants) {
  const group = new THREE.Group();
  const legs = makeBox(0.5, 0.55, 0.3, pants, 0, 0.28, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 8), new THREE.MeshLambertMaterial({ color: shirt }));
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshLambertMaterial({ color: '#e8b98a' }));
  head.position.y = 1.55;
  group.add(legs, torso, head);
  group.userData.torso = torso;
  group.userData.shirtColor = shirt;
  return group;
}

function makePoliceMesh() {
  const group = makeCarMesh(col(COLORS && COLORS.police, '#1a1a2e'));
  const stripe = makeBox(2.12, 0.16, 4.0, '#dfe6ee', 0, 0.72, 0);
  group.add(stripe);
  const bar = makeBox(1.1, 0.18, 0.4, '#222222', 0, 1.45, -0.2);
  const lampL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: '#ff2d2d' }));
  const lampR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: '#2d7dff' }));
  lampL.position.set(-0.3, 1.56, -0.2);
  lampR.position.set(0.3, 1.56, -0.2);
  group.add(bar, lampL, lampR);
  group.userData.lampL = lampL;
  group.userData.lampR = lampR;
  return group;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = col(COLORS && COLORS.sky, '#87b5d6');
  scene.fog = new THREE.Fog(col(COLORS && COLORS.sky, '#87b5d6').getHex(), 150, 520);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 1000);
  camera.position.set(0, 60, 90);

  const sun = new THREE.DirectionalLight(col(COLORS && COLORS.sun, '#fff2cc'), 2.4);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight('#bcd8ff', '#5a4a3a', 1.1));
  scene.add(new THREE.AmbientLight('#ffffff', 0.25));

  // Ground: the verge outside the road grid, plus the road grid itself.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_SIZE + 220, CITY_SIZE + 220), new THREE.MeshLambertMaterial({ color: col(COLORS && COLORS.ground, '#3d3d3d') }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: col(COLORS && COLORS.road, '#2b2b2e') });
  const dashMat = new THREE.MeshBasicMaterial({ color: '#e8e4d0' });
  const walkMat = new THREE.MeshLambertMaterial({ color: col(COLORS && COLORS.sidewalk, '#8a8a86') });
  const roadCenters = [];
  for (let i = 0; i <= BLOCKS; i += 1) roadCenters.push(-HALF + i * PITCH);
  for (const c of roadCenters) {
    for (const vertical of [true, false]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? ROAD : CITY_SIZE, vertical ? CITY_SIZE : ROAD), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(vertical ? c : 0, 0, vertical ? 0 : c);
      scene.add(road);
      // Centre dashes down each road.
      for (let d = -HALF + 14; d < HALF - 6; d += 14) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? 0.5 : 4, vertical ? 4 : 0.5), dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(vertical ? c : d, 0.02, vertical ? d : c);
        scene.add(dash);
      }
    }
  }
  // Sidewalk slabs inside each block.
  for (let bx = 0; bx < BLOCKS; bx += 1) {
    for (let bz = 0; bz < BLOCKS; bz += 1) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(PITCH - ROAD + 2, PITCH - ROAD + 2), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(-HALF + PITCH / 2 + bx * PITCH, 0.01, -HALF + PITCH / 2 + bz * PITCH);
      scene.add(walk);
    }
  }

  // Buildings: rebuilt from state.city.buildings the first time draw() sees a
  // city (world.js owns the layout, so the renderer never invents its own).
  const buildingGroup = new THREE.Group();
  scene.add(buildingGroup);
  let builtCity = null;
  function rebuildBuildings(city) {
    while (buildingGroup.children.length) {
      const child = buildingGroup.children.pop();
      child.geometry.dispose();
      child.material.dispose();
    }
    builtCity = city;
    for (const b of city.buildings || []) {
      const tower = makeBox(b.w, b.h, b.d, b.color !== undefined ? b.color : BUILDING_COLORS[0], b.x, b.h / 2, b.z);
      buildingGroup.add(tower);
      const band = makeBox(b.w * 0.92, 0.5, b.d * 0.92, '#ffe9a8', b.x, b.h - 1.2, b.z);
      buildingGroup.add(band);
    }
  }

  // Street lamps and trees along the roads.
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: '#3a3f46' });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8' });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#4e8a4e' });
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
  for (let i = 0; i <= BLOCKS; i += 1) {
    for (let j = 0; j < BLOCKS; j += 1) {
      const c = -HALF + PITCH / 2 + j * PITCH;
      const along = -HALF + i * PITCH;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 6), lampPoleMat);
      pole.position.set(along + ROAD / 2 + 0.6, 2.5, c);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampHeadMat);
      head.position.set(along + ROAD / 2 + 0.6, 5.1, c);
      scene.add(pole, head);
      if ((i + j) % 2 === 0) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 6), trunkMat);
        trunk.position.set(c, 0.7, along - ROAD / 2 - 0.8);
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), leafMat);
        leaves.position.set(c, 2.4, along - ROAD / 2 - 0.8);
        scene.add(trunk, leaves);
      }
    }
  }

  // Mission beacon: a floating gold cone over the target, plus a ground ring.
  const beacon = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.2, 12), new THREE.MeshBasicMaterial({ color: col(COLORS && COLORS.target, '#ffd32a') }));
  cone.rotation.x = Math.PI;
  cone.position.y = 7;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.28, 8, 28), new THREE.MeshBasicMaterial({ color: col(COLORS && COLORS.target, '#ffd32a') }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  beacon.add(cone, ring);
  beacon.visible = false;
  scene.add(beacon);

  // Player on foot; hidden while driving (the driver sits in the car mesh).
  const playerMesh = makePersonMesh(col(COLORS && COLORS.playerShirt, '#e74c3c'), '#2c3e50');
  scene.add(playerMesh);

  // Pooled meshes: created once, reused every frame, never allocated in draw().
  const carPool = [];
  for (let i = 0; i < MAX_CARS; i += 1) {
    const mesh = makeCarMesh(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
    mesh.visible = false;
    scene.add(mesh);
    carPool.push(mesh);
  }
  const pedPool = [];
  for (let i = 0; i < MAX_PEDS; i += 1) {
    const mesh = makePersonMesh(PED_COLORS[i % PED_COLORS.length], '#3b3b3b');
    mesh.visible = false;
    scene.add(mesh);
    pedPool.push(mesh);
  }
  const policePool = [];
  for (let i = 0; i < MAX_POLICE; i += 1) {
    const mesh = makePoliceMesh();
    mesh.visible = false;
    scene.add(mesh);
    policePool.push(mesh);
  }

  // ---- HUD (DOM overlay, so it stays readable in screenshots) ----
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;z-index:5;';
  hud.innerHTML = [
    '<div id="hud-top" style="position:absolute;top:14px;left:16px;font-size:22px;line-height:1.5;text-shadow:0 2px 4px rgba(0,0,0,.7);">',
    '<div id="hud-wanted" style="font-size:26px;letter-spacing:3px;"></div>',
    '<div id="hud-cash"></div>',
    '<div id="hud-score" style="font-size:17px;color:#d5e8ff;"></div>',
    '<div id="hud-health" style="width:150px;height:12px;background:rgba(0,0,0,.5);border:1px solid #fff;margin-top:4px;"><div id="hud-health-fill" style="height:100%;background:#58d68d;"></div></div>',
    '<div id="hud-ammo" style="font-size:17px;"></div>',
    '</div>',
    '<div id="hud-speed" style="position:absolute;left:16px;bottom:16px;font-size:30px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.7);"></div>',
    '<div id="hud-mission" style="position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:46%;text-align:center;font-size:18px;background:rgba(0,0,0,.55);padding:8px 14px;border-radius:8px;"></div>',
    '<div id="hud-mute" style="position:absolute;right:16px;bottom:16px;font-size:15px;background:rgba(0,0,0,.55);padding:4px 8px;border-radius:6px;"></div>',
    '<div id="hud-toast" style="position:absolute;left:50%;top:64px;transform:translateX(-50%);font-size:20px;font-weight:700;background:rgba(0,0,0,.65);padding:8px 16px;border-radius:8px;display:none;"></div>',
    '<div id="hud-panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,86vw);text-align:center;background:rgba(10,18,32,.82);padding:28px 24px;border-radius:14px;border:1px solid rgba(255,255,255,.25);"></div>',
  ].join('');
  document.body.appendChild(hud);
  const mapCanvas = document.createElement('canvas');
  mapCanvas.id = 'hud-map';
  mapCanvas.width = 168;
  mapCanvas.height = 168;
  mapCanvas.style.cssText = 'position:absolute;top:14px;right:16px;width:168px;height:168px;border:2px solid rgba(255,255,255,.7);border-radius:8px;background:rgba(10,20,30,.75);';
  hud.appendChild(mapCanvas);
  const mapCtx = mapCanvas.getContext('2d');

  const el = (id) => document.getElementById(id);
  const wantedEl = el('hud-wanted');
  const cashEl = el('hud-cash');
  const scoreEl = el('hud-score');
  const healthFill = el('hud-health-fill');
  const ammoEl = el('hud-ammo');
  const speedEl = el('hud-speed');
  const missionEl = el('hud-mission');
  const muteEl = el('hud-mute');
  const toastEl = el('hud-toast');
  const panelEl = el('hud-panel');

  const cache = { wanted: -1, cash: -1, score: -1, health: -1, ammo: -1, speed: -1, mission: '', panel: null, mute: null };
  const camTarget = new THREE.Vector3(0, 0, 0);
  const camPos = new THREE.Vector3(0, 60, 90);
  let lastHeading = 0;
  let toastTimer = 0;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** A short centre-top message (bust, job done); hides itself after 2.5 s. */
  function flash(message) {
    toastEl.textContent = message;
    toastEl.style.display = 'block';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.style.display = 'none';
    }, 2500);
  }

  function drawMinimap(state) {
    const s = 168;
    const scale = s / (CITY_SIZE + 40);
    const toMap = (x, z) => [(x + HALF + 20) * scale, (z + HALF + 20) * scale];
    mapCtx.clearRect(0, 0, s, s);
    mapCtx.fillStyle = '#16222e';
    mapCtx.fillRect(0, 0, s, s);
    mapCtx.strokeStyle = 'rgba(255,255,255,.28)';
    mapCtx.lineWidth = 2;
    for (const c of roadCenters) {
      const m = (c + HALF + 20) * scale;
      mapCtx.beginPath(); mapCtx.moveTo(m, 0); mapCtx.lineTo(m, s); mapCtx.stroke();
      mapCtx.beginPath(); mapCtx.moveTo(0, m); mapCtx.lineTo(s, m); mapCtx.stroke();
    }
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      mapCtx.fillStyle = color;
      mapCtx.beginPath(); mapCtx.arc(mx, my, r, 0, Math.PI * 2); mapCtx.fill();
    };
    const active = state.missions && state.missions.list
      ? state.missions.list.find((m) => m.id === state.missions.activeId) : null;
    if (active && active.target) dot(active.target.x, active.target.z, 6, '#ffc93c');
    for (const car of state.cars || []) dot(car.x, car.z, 2.5, '#9aa5b1');
    for (const cop of state.police || []) dot(cop.x, cop.z, 4, Math.floor(state.time * 4) % 2 ? '#ff2d2d' : '#2d7dff');
    const p = state.player;
    if (p) {
      const [mx, my] = toMap(p.x, p.z);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.moveTo(mx, my - 7); mapCtx.lineTo(mx + 5, my + 5); mapCtx.lineTo(mx - 5, my + 5);
      mapCtx.closePath(); mapCtx.fill();
      mapCtx.strokeStyle = '#fff';
      mapCtx.beginPath(); mapCtx.arc(mx, my, 9, 0, Math.PI * 2); mapCtx.stroke();
    }
  }

  function setPanel(html) {
    if (cache.panel === html) return;
    cache.panel = html;
    panelEl.innerHTML = html;
    panelEl.style.display = html ? 'block' : 'none';
  }

  /** Paint one frame: sync every mesh to the world, move the camera, refresh the HUD. */
  function draw(state, screen, best, muted, shot) {
    if (state.city && state.city !== builtCity) rebuildBuildings(state.city);
    const p = state.player || { x: 0, z: 0, heading: 0, speed: 0, onFoot: true, carId: null, health: 100, cash: 0, wanted: 0 };
    const time = state.time || 0;

    // Player: on foot show the walker; in a car the driven car mesh carries them.
    if (p.onFoot) {
      playerMesh.visible = true;
      playerMesh.position.set(p.x, 0, p.z);
      playerMesh.rotation.y = p.heading || 0;
      playerMesh.position.y = Math.abs(Math.sin(time * 9)) * 0.06 * Math.min(1, Math.abs(p.speed || 0) / 3);
    } else {
      playerMesh.visible = false;
    }

    // Traffic cars from the pool; the player's own car is just one of them.
    const cars = state.cars || [];
    for (let i = 0; i < carPool.length; i += 1) {
      const mesh = carPool[i];
      const car = cars[i];
      if (!car) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = car.heading || 0;
      const spin = (car.speed || 0) * 0.12;
      for (const wheel of mesh.userData.wheels) wheel.rotation.x += spin;
      if (car.color !== undefined && mesh.userData.bodyColor !== car.color) {
        mesh.userData.bodyColor = car.color;
        try { mesh.userData.body.material.color.set(car.color); } catch { /* keep the pool colour */ }
      }
    }

    const peds = state.peds || [];
    for (let i = 0; i < pedPool.length; i += 1) {
      const mesh = pedPool[i];
      const ped = peds[i];
      if (!ped || ped.active === false) { mesh.visible = false; continue; }
      mesh.visible = true;
      if (ped.color !== undefined && mesh.userData.shirtColor !== ped.color) {
        mesh.userData.shirtColor = ped.color;
        try { mesh.userData.torso.material.color.set(ped.color); } catch { /* keep the pool colour */ }
      }
      if (ped.state === 'down') {
        // Knocked down: lying on the pavement.
        mesh.position.set(ped.x, 0.3, ped.z);
        mesh.rotation.set(0, ped.heading || 0, Math.PI / 2);
      } else {
        mesh.position.set(ped.x, Math.abs(Math.sin(time * 7 + i)) * 0.05, ped.z);
        mesh.rotation.set(0, ped.heading || 0, 0);
      }
    }

    const police = state.police || [];
    for (let i = 0; i < policePool.length; i += 1) {
      const mesh = policePool[i];
      const cop = police[i];
      if (!cop) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(cop.x, 0, cop.z);
      mesh.rotation.y = cop.heading || 0;
      const flash = Math.floor(time * 5 + i) % 2 === 0;
      mesh.userData.lampL.material.color.set(flash ? '#ff2d2d' : '#5a1010');
      mesh.userData.lampR.material.color.set(flash ? '#10265a' : '#2d7dff');
      for (const wheel of mesh.userData.wheels) wheel.rotation.x += (cop.speed || 0) * 0.12;
    }

    // Mission beacon over the active target.
    const active = state.missions && state.missions.list
      ? state.missions.list.find((m) => m.id === state.missions.activeId) : null;
    if (active && active.target && active.state !== 'done') {
      beacon.visible = true;
      beacon.position.set(active.target.x, 0, active.target.z);
      cone.position.y = 7 + Math.sin(time * 2.4) * 0.7;
      beacon.rotation.y = time * 0.9;
    } else {
      beacon.visible = false;
    }

    // Camera: third-person follow, pulled back and higher in a car, closer on foot.
    // Shot scenes get a fixed cinematic angle: high enough to read the city, the
    // player and the beacon in one frame. Title and intro get a slow orbit of the city.
    const heading = p.heading || 0;
    if ((screen === SCREEN_TITLE || screen === SCREEN_INTRO) && !shot) {
      const a = time * 0.08;
      camPos.set(Math.sin(a) * 150, 75, Math.cos(a) * 150);
      camTarget.set(0, 0, 0);
    } else if (shot) {
      const tx = active && active.target ? (p.x + active.target.x) / 2 : p.x;
      const tz = active && active.target ? (p.z + active.target.z) / 2 : p.z;
      if (shot === 'win' || shot === 'end') {
        // End cards sit behind the centre panel, so the frame reads as the
        // city grid (roads, blocks, traffic, skyline) instead of one flat
        // rooftop or a building facade filling the view. Buildings run
        // 12–40 m tall, so the camera stays above the tallest roof.
        camPos.set(p.x + Math.sin(heading + 0.6) * 60, 46, p.z + Math.cos(heading + 0.6) * 60);
        camTarget.set(tx, 3, tz);
      } else {
        camPos.set(p.x + Math.sin(heading + 0.6) * 34, 26, p.z + Math.cos(heading + 0.6) * 34);
        camTarget.set(tx, 2, tz);
      }
    } else {
      const dist = p.onFoot ? CAM_WALK_DIST : CAM_DRIVE_DIST;
      const height = p.onFoot ? CAM_WALK_HEIGHT : CAM_DRIVE_HEIGHT;
      const back = 0.12;
      lastHeading += (heading - lastHeading) * back;
      const fx = Math.sin(lastHeading);
      const fz = Math.cos(lastHeading);
      camPos.set(p.x - fx * dist, height, p.z - fz * dist);
      camTarget.set(p.x + fx * CAM_LOOK_AHEAD, 1.6, p.z + fz * CAM_LOOK_AHEAD);
    }
    camera.position.lerp(camPos, (screen === SCREEN_TITLE || screen === SCREEN_INTRO) && !shot ? 0.02 : 0.14);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);

    // ---- HUD ----
    const wanted = Math.max(0, Math.min(5, Math.round(p.wanted || 0)));
    if (cache.wanted !== wanted) {
      cache.wanted = wanted;
      let stars = '';
      for (let i = 0; i < 5; i += 1) stars += i < wanted ? '★' : '☆';
      wantedEl.textContent = stars;
      wantedEl.style.color = wanted >= 3 ? '#ff5a4e' : '#ffd94d';
    }
    const cash = Math.round(p.cash || 0);
    if (cache.cash !== cash) {
      cache.cash = cash;
      cashEl.textContent = `$${cash.toLocaleString('en-US')}`;
    }
    const score = Math.round(state.score || 0);
    if (cache.score !== score) {
      cache.score = score;
      scoreEl.textContent = `Score ${score}`;
    }
    const health = Math.max(0, Math.min(100, Math.round(p.health ?? 100)));
    if (cache.health !== health) {
      cache.health = health;
      healthFill.style.width = `${health}%`;
      healthFill.style.background = health > 50 ? '#58d68d' : health > 25 ? '#f5b041' : '#e74c3c';
    }
    const ammo = p.onFoot ? Math.round(p.ammo ?? 0) : -1;
    if (cache.ammo !== ammo) {
      cache.ammo = ammo;
      ammoEl.textContent = ammo >= 0 ? `Ammo ${ammo}` : '';
    }
    const kmh = Math.round(Math.abs(p.speed || 0) * 3.6);
    if (cache.speed !== kmh) {
      cache.speed = kmh;
      speedEl.textContent = p.onFoot ? 'On foot' : `${kmh} km/h`;
    }
    let missionText = 'No job yet — find a car and take a courier job.';
    if (active) {
      const dx = active.target ? active.target.x - p.x : 0;
      const dz = active.target ? active.target.z - p.z : 0;
      const dist = Math.round(Math.hypot(dx, dz));
      missionText = active.state === 'done' ? `Done: ${active.title}` : `${active.title} — ${active.text || ''} (${dist}m)`;
    }
    if (cache.mission !== missionText) {
      cache.mission = missionText;
      missionEl.textContent = missionText;
    }
    if (cache.mute !== muted) {
      cache.mute = muted;
      muteEl.textContent = muted ? 'Muted (M)' : '';
      // Empty text still leaves the padded, tinted box visible as a small
      // dark dot in the corner, so hide the element outright when unmuted.
      muteEl.style.display = muted ? 'block' : 'none';
    }
    drawMinimap(state);

    if (screen === SCREEN_TITLE) {
      setPanel(`<h1 style="margin:0 0 10px;font-size:42px;">Costa Verde Hustle</h1>`
        + `<p style="margin:6px 0;font-size:17px;">A courier, a borrowed car, and the whole harbor city.</p>`
        + `<p style="margin:6px 0;font-size:15px;color:#cfe0f0;">WASD drive &amp; walk · Shift boost · Space handbrake<br>E enter / steal a car · F attack · P pause · M mute</p>`
        + `<p style="margin:10px 0 0;font-size:15px;color:#ffd94d;">Best score ${best}</p>`
        + `<p style="margin:14px 0 0;font-size:18px;">Press Enter or click to start</p>`);
    } else if (screen === SCREEN_INTRO) {
      setPanel(`<h1 style="margin:0 0 10px;font-size:34px;">COSTA VERDE — 6 AM</h1>`
        + `<p style="margin:6px 0;font-size:17px;">First day on the harbor crew. The dispatcher hands you the keys to a borrowed car and one rule: keep the cargo moving, stay out of trouble.</p>`
        + `<p style="margin:6px 0;font-size:17px;">Dana is waiting at the north docks with the first package. Go get her — and bring her home safe.</p>`
        + `<p style="margin:14px 0 0;font-size:18px;">Press Enter or click to start</p>`);
    } else if (screen === SCREEN_PAUSED) {
      setPanel('<h1 style="margin:0 0 8px;font-size:36px;">Paused</h1><p style="font-size:16px;">The city waits for you.</p><p style="font-size:16px;">Press P to keep driving</p>');
    } else if (screen === SCREEN_OVER) {
      setPanel(`<h1 style="margin:0 0 8px;font-size:36px;">Game over</h1><p style="font-size:16px;">Costa Verde got the better of you this time.</p><p style="font-size:16px;">Score ${state.score || 0} · Best ${best}</p><p style="font-size:16px;">Press Enter to try again</p>`);
    } else if (screen === SCREEN_WIN) {
      setPanel(`<h1 style="margin:0 0 8px;font-size:36px;">Costa Verde is yours!</h1><p style="font-size:16px;">Every courier job done — the city knows your name.</p><p style="font-size:16px;">Score ${state.score || 0} · Best ${best}</p><p style="font-size:16px;">Press Enter to play again</p>`);
    } else {
      setPanel('');
    }
  }

  return { draw, flash };
}
