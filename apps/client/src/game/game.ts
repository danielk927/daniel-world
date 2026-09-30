import { Euler, Quaternion, Ray, Vector3 } from 'three';
import {
  DEFAULT_ROOM,
  EYE_HEIGHT,
  SPAWN,
  TICK_SECONDS,
  terrainHeight,
  type Emote,
} from '@world/shared';
import type { LoreEntry } from '../content.ts';
import { SERVER_URL } from '../env.ts';
import { Chat } from '../ui/chat.ts';
import { el } from '../ui/dom.ts';
import { Hud } from '../ui/hud.ts';
import { LabelLayer } from '../ui/labels.ts';
import type { Landing } from '../ui/landing.ts';
import { InfoPanel } from '../ui/panel.ts';
import { PauseMenu } from '../ui/pause.ts';
import { Scoreboard } from '../ui/scoreboard.ts';
import { Toasts } from '../ui/toast.ts';
import type { WorldScene } from '../world/scene.ts';
import { CameraRig } from './cameraRig.ts';
import { Input } from './input.ts';
import { LocalPlayer } from './localPlayer.ts';
import { Multiplayer } from './multiplayer.ts';

export type Mode = 'landing' | 'entering' | 'playing' | 'chat' | 'paused' | 'panel';

const ENTER_DURATION = 1.6;
const MAX_CATCH_UP_TICKS = 5;
const EMOTE_COOLDOWN_MS = 1000;
const EMOTE_KEYS: Record<string, Emote> = { Digit1: 'wave', Digit2: 'dance', Digit3: 'jump' };
const EMOTE_TOASTS: Record<Emote, string> = {
  wave: '👋 You wave',
  dance: '💃 You dance',
  jump: '🎉 You jump for joy',
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Owns the frame loop and moves the player between landing, playing, chat and menus. */
export class Game {
  mode: Mode = 'landing';
  readonly player = new LocalPlayer();
  readonly input: Input;
  multiplayer: Multiplayer | null = null;
  private readonly world: WorldScene;
  private readonly landing: Landing;
  private readonly rig: CameraRig;
  private readonly labels: LabelLayer;
  private readonly hud: Hud;
  private readonly chat: Chat;
  private readonly pause: PauseMenu;
  private readonly panel: InfoPanel;
  private readonly toasts: Toasts;
  private readonly scoreboard: Scoreboard;

  private lastFrame = performance.now();
  private elapsed = 0;
  private accumulator = 0;
  private enterProgress = 0;
  private readonly enterFrom = new Vector3();
  private readonly enterFromQuat = new Quaternion();
  private readonly enterToQuat = new Quaternion();
  private readonly feet = new Vector3();
  private readonly ray = new Ray();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private hoveredIndex = -1;
  private lastEmoteAt = -Infinity;
  private room = DEFAULT_ROOM;
  /** Smoothed main-thread time spent per frame (simulation, animation, render submission), in ms. */
  frameCpuMs = 0;

  constructor(world: WorldScene, overlay: HTMLElement, landing: Landing) {
    this.world = world;
    this.landing = landing;
    const canvas = world.renderer.domElement;
    this.input = new Input(canvas);
    this.rig = new CameraRig(world.camera);
    this.labels = new LabelLayer(overlay, world.camera);
    this.hud = new Hud(overlay);
    this.chat = new Chat(overlay, {
      onSend: (text) => this.multiplayer?.sendChat(text),
      onClose: () => this.closeChat(),
    });
    this.scoreboard = new Scoreboard(overlay);
    this.toasts = new Toasts(overlay);
    this.panel = new InfoPanel(overlay);
    this.pause = new PauseMenu(
      overlay,
      {
        onResume: () => void this.resume(),
        onLeave: () => this.leave(),
        onSensitivity: (value) => this.input.setSensitivity(value),
        onCopyInvite: () => void this.copyInvite(),
        onStartTag: () => this.startTag(),
      },
      this.input.sensitivity,
    );

    this.world.lore.entries.forEach((entry, i) => {
      const anchor = this.world.lore.anchor(i);
      if (!anchor) return;
      const label = el('div', { class: 'lore-label' }, [el('span', { text: entry.title })]);
      label.style.setProperty('--accent-entry', entry.color);
      this.labels.add(label, anchor, 1.05, 24);
    });

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    this.panel.onClose = () => void this.resume();
    canvas.addEventListener('click', () => this.onCanvasClick());
    window.addEventListener('resize', () => {
      this.world.resize();
      this.labels.resize();
    });
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  get inWorld(): boolean {
    return (
      this.mode === 'playing' ||
      this.mode === 'chat' ||
      this.mode === 'paused' ||
      this.mode === 'panel'
    );
  }

  /** Called from the landing form submit, which is a user gesture, so pointer lock is allowed. */
  enter(name: string, room: string): void {
    if (this.mode !== 'landing') return;
    this.room = room;
    this.landing.hide();
    this.player.reset();
    this.input.yaw = SPAWN.yaw;
    this.input.pitch = 0;
    this.enterFrom.copy(this.world.camera.position);
    this.enterFromQuat.copy(this.world.camera.quaternion);
    this.enterToQuat.setFromEuler(this.euler.set(0, SPAWN.yaw, 0));
    this.enterProgress = 0;
    this.mode = 'entering';
    this.pause.setPrivateRoom(room !== DEFAULT_ROOM);
    this.chat.clear();
    this.multiplayer = new Multiplayer({
      url: SERVER_URL,
      name,
      room,
      player: this.player,
      avatars: this.world.avatars,
      labels: this.labels,
      hud: this.hud,
      chat: this.chat,
      scoreboard: this.scoreboard,
      worldTime: () => this.elapsed,
      notify: (message) => this.toasts.show(message),
      onFatal: (message) => this.leave(message),
      onSpawn: (yaw) => {
        this.input.yaw = yaw;
        this.input.pitch = 0;
        this.enterToQuat.setFromEuler(this.euler.set(0, yaw, 0));
      },
    });
    void this.input.lock();
  }

  /** Back to the landing screen, optionally explaining why. */
  leave(reason = ''): void {
    // Set the mode first: closing the panel would otherwise try to resume play.
    this.mode = 'landing';
    this.pause.hide();
    this.panel.close();
    this.chat.hide();
    this.hud.hide();
    this.hud.setCovered(false);
    this.hud.setPrompt(null);
    this.input.enabled = false;
    this.input.unlock();
    this.multiplayer?.close();
    this.multiplayer = null;
    this.landing.setNotice(reason);
    this.landing.show();
  }

  private beginPlaying(): void {
    this.mode = 'playing';
    this.input.enabled = true;
    this.hud.show();
    this.chat.show();
    if (!this.input.locked) this.toasts.show('Click the world to look around with the mouse');
  }

  /** Back to playing from a menu. Tries pointer lock, and plays unlocked if the browser refuses. */
  private async resume(): Promise<void> {
    if (this.mode !== 'paused' && this.mode !== 'panel') return;
    this.pause.hide();
    this.hud.setCovered(false);
    this.mode = 'playing';
    this.input.enabled = true;
    const locked = await this.input.lock();
    if (!locked && this.mode === 'playing') {
      this.toasts.show('Click the world to look around with the mouse');
    }
  }

  private openPause(note = ''): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.unlock();
    this.hud.setCovered(true);
    this.pause.show(note);
  }

  private openPanel(entry: LoreEntry): void {
    this.mode = 'panel';
    this.input.enabled = false;
    this.input.releaseAll();
    this.hud.setPrompt(null);
    this.hud.setCovered(true);
    this.input.unlock();
    this.panel.open(entry);
  }

  private openChat(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'chat';
    this.input.enabled = false;
    this.input.releaseAll();
    this.chat.open();
  }

  private closeChat(): void {
    if (this.mode !== 'chat') return;
    this.mode = 'playing';
    this.input.enabled = true;
  }

  private playEmote(emote: Emote): void {
    const now = performance.now();
    if (now - this.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt = now;
    this.multiplayer?.sendEmote(emote);
    this.toasts.show(EMOTE_TOASTS[emote], 1600);
  }

  private startTag(): void {
    if (!this.multiplayer) return;
    const problem = this.multiplayer.startTag();
    if (problem) {
      this.toasts.show(problem, 3500);
      return;
    }
    void this.resume();
  }

  private async copyInvite(): Promise<void> {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', this.room);
    try {
      await navigator.clipboard.writeText(url.toString());
      this.toasts.show('Invite link copied');
    } catch {
      this.toasts.show(`Share this link: ${url.toString()}`, 6000);
    }
  }

  private onLockChange(locked: boolean): void {
    if (locked) return;
    // Losing the lock while playing means the player pressed Esc (or the browser took it away).
    if (this.mode === 'chat') {
      this.chat.close();
      this.openPause();
    } else if (this.mode === 'playing') {
      this.openPause();
    }
  }

  private onKey(code: string): boolean {
    if (this.mode !== 'playing') return false;
    if (code === 'Escape' && !this.input.locked) {
      this.openPause();
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      this.openChat();
    } else if (code in EMOTE_KEYS) {
      this.playEmote(EMOTE_KEYS[code]!);
    } else {
      return false;
    }
    return true;
  }

  private onCanvasClick(): void {
    if (this.mode !== 'playing' || !this.input.pressWasClick) return;
    const entry = this.world.lore.hoveredEntry;
    if (entry) {
      this.openPanel(entry);
    } else if (!this.input.locked) {
      void this.input.lock();
    }
  }

  private tick(): void {
    const wasGrounded = this.player.state.grounded;
    const fallSpeed = -this.player.state.vy;
    const online = this.multiplayer?.isOnline ?? false;
    const input = this.player.tick(this.input.keys, this.input.yaw, this.input.pitch, online);
    if (online) this.multiplayer?.sendInput(input);
    if (!wasGrounded && this.player.state.grounded) this.rig.land(fallSpeed);
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const started = performance.now();
    // Long enough to catch up MAX_CATCH_UP_TICKS after a hitch, short enough to not fast-forward.
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.elapsed += dt;

    if (this.inWorld) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= TICK_SECONDS && steps < MAX_CATCH_UP_TICKS) {
        this.tick();
        this.accumulator -= TICK_SECONDS;
        steps++;
      }
      // After a long stall, drop the backlog instead of fast-forwarding.
      if (steps === MAX_CATCH_UP_TICKS) this.accumulator = 0;
    }

    this.multiplayer?.update(now, dt);
    this.updateCamera(dt);
    // Labels and picking project through the camera, so its matrices must be current.
    this.world.camera.updateMatrixWorld();
    this.world.update(this.elapsed, dt);
    this.updateHover();
    this.labels.update();
    this.world.render();
    this.frameCpuMs += (performance.now() - started - this.frameCpuMs) * 0.05;
  };

  private updateCamera(dt: number): void {
    const camera = this.world.camera;
    if (this.mode === 'landing') {
      const angle = this.elapsed * 0.035 + 2.4;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      camera.position.set(sin * 46, 17, -cos * 46);
      // On wide screens, aim left of the island so it sits beside the landing card, not under it.
      const shift = camera.aspect > 1.3 ? 8 : 0;
      camera.lookAt(-cos * shift, -1, -sin * shift);
      return;
    }
    if (this.mode === 'entering') {
      this.enterProgress = Math.min(1, this.enterProgress + dt / ENTER_DURATION);
      const t = easeInOutCubic(this.enterProgress);
      const s = this.player.state;
      const eyeY = terrainHeight(s.x, s.z) + EYE_HEIGHT;
      camera.position.set(s.x, eyeY, s.z).lerp(this.enterFrom, 1 - t);
      // Arc up a little so the swoop does not clip through trees.
      camera.position.y += Math.sin(t * Math.PI) * 6;
      camera.quaternion.slerpQuaternions(this.enterFromQuat, this.enterToQuat, t);
      if (this.enterProgress >= 1) this.beginPlaying();
      return;
    }
    const alpha = this.accumulator / TICK_SECONDS;
    this.player.renderPosition(alpha, dt, this.feet);
    const s = this.player.state;
    this.rig.update(
      dt,
      this.feet,
      this.input.yaw,
      this.input.pitch,
      this.player.horizontalSpeed,
      s.grounded,
    );
  }

  private updateHover(): void {
    let index = -1;
    if (this.mode === 'playing') {
      const camera = this.world.camera;
      this.ray.origin.copy(camera.position);
      if (this.input.locked) {
        camera.getWorldDirection(this.ray.direction);
      } else {
        // Without pointer lock the cursor is free, so pick under the cursor, not the screen center.
        this.ray.direction
          .set(
            (this.input.cursorX / window.innerWidth) * 2 - 1,
            -(this.input.cursorY / window.innerHeight) * 2 + 1,
            0.5,
          )
          .unproject(camera)
          .sub(camera.position)
          .normalize();
      }
      index = this.world.lore.pick(this.ray);
    }
    if (index === this.hoveredIndex) return;
    this.hoveredIndex = index;
    this.world.lore.setHovered(index);
    const entry = this.world.lore.hoveredEntry;
    this.hud.setPrompt(entry ? `Click to open ${entry.title}` : null);
  }
}
