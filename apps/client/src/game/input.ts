import { Keys, MAX_PITCH } from '@world/shared';
import { storage } from '../util/storage.ts';

const MOVEMENT_KEYS: Record<string, number> = {
  KeyW: Keys.Forward,
  ArrowUp: Keys.Forward,
  KeyS: Keys.Back,
  ArrowDown: Keys.Back,
  KeyA: Keys.Left,
  ArrowLeft: Keys.Left,
  KeyD: Keys.Right,
  ArrowRight: Keys.Right,
  Space: Keys.Jump,
  ShiftLeft: Keys.Sprint,
  ShiftRight: Keys.Sprint,
};

const SENSITIVITY_KEY = 'world.sensitivity';
const DEFAULT_SENSITIVITY = 1;
/** Radians per pixel at sensitivity 1. */
const BASE_RADIANS_PER_PIXEL = 0.0022;

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Keyboard and mouse state for first-person play. Uses pointer lock when the browser allows it and
 * falls back to click-and-drag looking when it does not.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  /** When false, movement keys and mouse look are ignored (menus, chat, landing). */
  enabled = false;
  sensitivity: number;
  /** Called for non-movement key presses while enabled, e.g. Enter, Q or I. */
  /** Return true if the key was handled, which also cancels its default browser action. */
  onKey: ((code: string) => boolean) | null = null;
  /** Called when the left button goes down while playing with the pointer locked. */
  onPrimary: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  private held = 0;
  private readonly heldCodes = new Set<string>();
  private dragging = false;
  private dragTravel = 0;
  private primaryHeld = false;
  /** Pointer lock has worked at least once here, so a refusal now is temporary, not for good. */
  lockWorks = false;
  /** Last cursor position in CSS pixels, used for picking when the pointer is not locked. */
  cursorX = window.innerWidth / 2;
  cursorY = window.innerHeight / 2;

  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    const stored = Number(storage.get(SENSITIVITY_KEY));
    this.sensitivity = stored > 0 ? stored : DEFAULT_SENSITIVITY;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  get keys(): number {
    return this.enabled ? this.held : 0;
  }

  /** The left button is held down while playing with the pointer locked, e.g. to keep throwing. */
  get firing(): boolean {
    return this.enabled && this.locked && this.primaryHeld;
  }

  /** Treat the left button as let go until it is pressed again. */
  releasePrimary(): void {
    this.primaryHeld = false;
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
    storage.set(SENSITIVITY_KEY, String(value));
  }

  /** Must be called from a user gesture. Resolves to whether the pointer is now locked. */
  async lock(): Promise<boolean> {
    if (this.locked) return true;
    if (!('requestPointerLock' in this.target)) return false;
    try {
      // Raw mouse input where supported; not every platform allows it.
      await this.target.requestPointerLock({ unadjustedMovement: true });
      return true;
    } catch {
      try {
        await this.target.requestPointerLock();
        return true;
      } catch {
        return false;
      }
    }
  }

  /** True if the mouse barely moved since the last press, i.e. the press was a click, not a drag. */
  get pressWasClick(): boolean {
    return this.locked || this.dragTravel < 6;
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Forget held keys, e.g. when a menu opens so the player does not keep walking. */
  readonly releaseAll = (): void => {
    this.held = 0;
    this.heldCodes.clear();
    this.dragging = false;
    this.primaryHeld = false;
  };

  private recomputeHeld(): void {
    let bits = 0;
    for (const code of this.heldCodes) bits |= MOVEMENT_KEYS[code] ?? 0;
    this.held = bits;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Already handled by a dialog, or typed into a field.
    if (event.defaultPrevented || isTextField(event.target)) return;
    const bit = MOVEMENT_KEYS[event.code];
    if (bit !== undefined) {
      if (!this.enabled) return;
      // Stop Space from scrolling or pressing a focused button while playing.
      event.preventDefault();
      this.heldCodes.add(event.code);
      this.recomputeHeld();
      return;
    }
    // Cancelling matters for Enter: otherwise the press that opens the chat also submits it.
    if (this.enabled && !event.repeat && this.onKey?.(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.heldCodes.delete(event.code)) this.recomputeHeld();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.dragTravel = 0;
    if (event.button !== 0) return;
    if (!this.locked) {
      this.dragging = true;
    } else if (this.enabled) {
      this.primaryHeld = true;
      this.onPrimary?.();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.dragging = false;
    if (event.button === 0) this.primaryHeld = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.dragTravel += Math.abs(event.movementX) + Math.abs(event.movementY);
    this.cursorX = event.clientX;
    this.cursorY = event.clientY;
    if (!this.enabled || (!this.locked && !this.dragging)) return;
    const scale = BASE_RADIANS_PER_PIXEL * this.sensitivity;
    this.yaw -= event.movementX * scale;
    this.pitch -= event.movementY * scale;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  };

  private readonly onPointerLockChange = (): void => {
    if (this.locked) this.lockWorks = true;
    else this.releaseAll();
    this.onLockChange?.(this.locked);
  };
}
