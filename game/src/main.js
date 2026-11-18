// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between five screens:
// title, play, paused, game over and win.
//
// A bust is not game over: the police fine the player and dump them back at
// the spawn, and play goes on. Only health hitting zero (EVENT_OVER) ends a
// run, and finishing the story chain (EVENT_WIN) wins it.
//
// ?seed=N fixes the city. ?shot=start|play|win|end (with &seed=N) stages that
// scene instead of running the loop, paints it several times so the three.js
// shaders finish compiling, and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_BUSTED,
  EVENT_DELIVER,
  EVENT_HIT,
  EVENT_MISSION_DONE,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_WANTED_UP,
  EVENT_WIN,
  saveProgress,
  step,
} from './world.js';
import { ACTION_ATTACK, ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** Shot frames: three.js needs several renders for shaders to compile and the camera to settle. */
const SHOT_FRAMES = 12;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
let seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
let world = createWorld(createRandom(seed), { fresh: Boolean(shot) });
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, scene.best, false, name);
    painted += 1;
    if (painted < SHOT_FRAMES) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput();
  let screen = SCREEN_TITLE;
  let best = Math.max(readBest(), world.best || 0);
  let muted = false;
  let accumulator = 0;
  let last = performance.now();
  // One-shot presses queue here; handleActions takes the menu keys, step()
  // takes the rest (INTERACT, ATTACK) once per frame, so a press is never
  // lost or doubled.
  let pendingActions = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    // A fresh world: a new seed, a new city, and a fresh mission chain.
    // The save is ignored here on purpose: winning once must not leave every
    // later "new game" with the story already done (only idle browsing).
    seed = Math.floor(Math.random() * 4294967296);
    world = createWorld(createRandom(seed), { fresh: true });
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.resume();
    audio.play('click');
    announce('Playing. Take the courier job, and stay ahead of the harbor police.');
  }

  function endGame(won) {
    screen = won ? SCREEN_WIN : SCREEN_OVER;
    if (world.score > best) {
      best = world.score;
      saveBest(best);
    }
    saveProgress(world);
    if (won) {
      audio.play('win');
      announce(`You win. Score ${world.score}. Best ${best}.`);
    } else {
      audio.play('busted');
      announce(`Game over. Score ${world.score}. Best ${best}.`);
    }
  }

  function handleActions() {
    pendingActions |= input.takeActions();
    const actions = pendingActions;
    if (actions & ACTION_MUTE) {
      muted = !muted;
      audio.setMuted(muted);
      announce(muted ? 'Muted.' : 'Sound on.');
      pendingActions &= ~ACTION_MUTE;
    }
    if (actions & ACTION_ATTACK) {
      // Sound only here; the ATTACK bit stays queued so step() still sees it.
      if (screen === SCREEN_PLAY) {
        const p = world.player || {};
        audio.play(p.hasGun && (p.ammo || 0) > 0 ? 'shoot' : 'punch');
      }
    }
    if (actions & ACTION_CONFIRM) {
      pendingActions &= ~ACTION_CONFIRM;
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_WIN) startGame();
      else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      pendingActions &= ~ACTION_PAUSE;
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function stepOnce() {
    if (screen === SCREEN_TITLE) {
      // Living backdrop: the city idles with no input while the title is up.
      step(world, STEP, null, 0);
      return;
    }
    const vec = input.keyVector ? input.keyVector() : null;
    const actions = pendingActions;
    pendingActions = 0;
    const events = step(world, STEP, vec, actions) || 0;
    if (world.best > best) best = world.best;
    if (events & EVENT_PICKUP) audio.play('pickup');
    if (events & EVENT_DELIVER) audio.play('deliver');
    if (events & EVENT_HIT) {
      audio.play('hit');
      announce(`Hit. Health ${Math.round(world.player.health || 0)}.`);
    }
    if (events & EVENT_WANTED_UP) {
      audio.play('wanted');
      announce(`Wanted level ${world.player.wanted}. The police are coming.`);
    }
    if (events & EVENT_MISSION_DONE) {
      renderer.flash('Job done! Cash in.');
      announce('Job done. Cash in.');
    }
    if (events & EVENT_BUSTED) {
      audio.play('busted');
      renderer.flash('Busted! Fined $120 — back to the start.');
      announce('Busted. Fined $120. The heat is off — for now.');
    }
    if (events & EVENT_WIN) endGame(true);
    else if (events & EVENT_OVER) endGame(false);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        stepOnce();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const p = world.player || {};
    audio.engine(p.speed || 0, !p.onFoot && screen === SCREEN_PLAY);
    audio.siren((world.police || []).length > 0 && screen === SCREEN_PLAY);
    renderer.draw(world, screen, best, muted);
  }

  // Leaving the tab pauses a running game rather than letting the police close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Costa Verde Hustle. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
