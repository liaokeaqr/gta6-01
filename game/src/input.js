// Keyboard and pointer input for Costa Verde. Held keys give a steering
// vector; one-shot presses (confirm, pause, mute, interact, attack) are
// queued as bit flags and taken once by the loop, so a press between two
// frames is never lost and never counted twice.
//
// Mapping: WASD / arrows drive and walk (W/S forward-back, A/D steer-turn),
// Shift held is the accelerator (run on foot), Space held is the handbrake,
// E interacts (enter or steal a car, pick up, talk), F or a mouse click
// attacks, Enter confirms, P or Esc pauses, M mutes.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_INTERACT = 8;
export const ACTION_ATTACK = 16;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const BRAKE = new Set(['Space']);
const BOOST = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);
const INTERACT = new Set(['KeyE']);
const ATTACK = new Set(['KeyF']);
const PREVENT = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Enter',
]);

export function createInput() {
  let forward = false;
  let back = false;
  let left = false;
  let right = false;
  let brake = false;
  let boost = false;
  let actions = 0;

  function onKeyDown(event) {
    if (FORWARD.has(event.code)) forward = true;
    else if (BACK.has(event.code)) back = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (BRAKE.has(event.code)) brake = true;
    else if (BOOST.has(event.code)) boost = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (INTERACT.has(event.code)) {
      if (!event.repeat) actions |= ACTION_INTERACT;
    } else if (ATTACK.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ATTACK;
    } else return;
    if (PREVENT.has(event.code)) event.preventDefault();
  }

  function onKeyUp(event) {
    if (FORWARD.has(event.code)) forward = false;
    else if (BACK.has(event.code)) back = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (BRAKE.has(event.code)) brake = false;
    else if (BOOST.has(event.code)) boost = false;
  }

  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur so the player never comes back to a stuck key.
  function onBlur() {
    forward = false;
    back = false;
    left = false;
    right = false;
    brake = false;
    boost = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

  return {
    /**
     * Held steering, always an object (never null): x is -1 (left) to 1
     * (right), y is -1 (back) to 1 (forward), normalised to length 1.
     * brake is Space held (handbrake), boost is Shift held (accelerator).
     */
    keyVector() {
      let x = (right ? 1 : 0) - (left ? 1 : 0);
      let y = (forward ? 1 : 0) - (back ? 1 : 0);
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      return { x, y, brake, boost };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Reserved for a future dash / special move; always 0 for now. */
    takeDash() {
      return 0;
    },
  };
}
