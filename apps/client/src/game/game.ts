import { Euler, Quaternion, Ray, Vector3 } from 'three';
import {
  COMPUTER,
  DEFAULT_ROOM,
  EYE_HEIGHT,
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  SPAWN,
  TICK_SECONDS,
  coolerWallBetween,
  launchKnife,
  type InputMessage,
  type KnifeTarget,
  type RoomIntent,
} from '@world/shared';
import type { LoreEntry } from '../content.ts';
import { SERVER_URL } from '../env.ts';
import { JoinError, joinRoom, type JoinedRoom } from '../net/connection.ts';
import { Chat } from '../ui/chat.ts';
import { ComputerGuide } from '../ui/computerGuide.ts';
import { el } from '../ui/dom.ts';
import { Hud } from '../ui/hud.ts';
import { Impact } from '../ui/impact.ts';
import { KillFeed, type KillParty } from '../ui/killFeed.ts';
import { Knockout } from '../ui/knockout.ts';
import { LabelLayer, type Label } from '../ui/labels.ts';
import { Loadout } from '../ui/loadout.ts';
import { Minimap } from '../ui/minimap.ts';
import type { Landing } from '../ui/landing.ts';
import { InfoPanel } from '../ui/panel.ts';
import { PauseMenu } from '../ui/pause.ts';
import { Toasts } from '../ui/toast.ts';
import type { WorldScene } from '../world/scene.ts';
import { computerViewpoint } from '../world/computer.ts';
import { PICK_DISTANCE } from '../world/stations.ts';
import { PUNCH, THROW, type Viewmodel } from '../world/viewmodel.ts';
import { CameraRig } from './cameraRig.ts';
import { ComputerDesk } from './computerDesk.ts';
import { CoolerControl } from './cooler.ts';
import { Input } from './input.ts';
import { LandingCamera } from './landingCamera.ts';
import { LocalPlayer } from './localPlayer.ts';
import { Multiplayer } from './multiplayer.ts';
import { addressForRoom, inviteLink, joinFailureMessage, roomName } from './party.ts';
import { prefsOf, type Settings } from './settings.ts';
import type { Quality } from '../util/capabilities.ts';

export type Mode = 'landing' | 'entering' | 'playing' | 'chat' | 'paused' | 'panel' | 'computer';

/** Seconds to glide between standing and sitting square in front of the computer. */
const COMPUTER_GLIDE = 0.55;
const MAX_CATCH_UP_TICKS = 5;

const NO_TARGETS: readonly KnifeTarget[] = [];

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
  private readonly minimap: Minimap;
  private readonly loadout: Loadout;
  private readonly knockout: Knockout;
  private readonly killFeed: KillFeed;
  private readonly impact: Impact;
  private readonly viewmodel: Viewmodel;
  private readonly settings: Settings;
  /** Down on the floor after a knife hit, until the server stands this player back up. */
  knockedOut = false;
  /** Whether the knockout card has said Chef Skinner can be turned off; it says so once. */
  private toldAboutChef = false;
  /** Holding the knife (true) or the bare hand. Q switches. */
  armed = true;
  /** World time the throw animation lets go of the knife; the tick after that throws it. */
  private throwAt: number | null = null;
  /** A punch the next input carries to the server, and the world time it was thrown. */
  private punchPending = false;
  private punchAt = 0;
  /** The walk-in cooler's door: the hits on it, and when its doorway opens for this player. */
  readonly cooler: CoolerControl;
  private readonly hand = new Vector3();
  private lastThrowSeq = -Infinity;

  private lastFrame = performance.now();
  private elapsed = 0;
  private accumulator = 0;
  /** The slow walk round the kitchen behind the landing, and the swoop from it into the game. */
  private readonly landingCamera = new LandingCamera();
  private enterProgress = 0;
  private readonly enterFrom = new Vector3();
  private readonly enterFromQuat = new Quaternion();
  private readonly enterToQuat = new Quaternion();
  private readonly feet = new Vector3();
  private readonly ray = new Ray();
  private readonly reach = new Vector3();
  /** The kitchen computer on the chef's desk, which runs DOOM. */
  readonly desk: ComputerDesk;
  private readonly computerGuide: ComputerGuide;
  private computerHovered = false;
  private computerLabel: Label | null = null;
  /** 0 standing in the kitchen, 1 square in front of the computer's screen; eases between. */
  private computerBlend = 0;
  private readonly computerView = new Vector3();
  private readonly computerQuat = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private hoveredIndex = -1;
  private readonly stationLabels: Label[] = [];
  private room = DEFAULT_ROOM;
  /** The name this player entered with. */
  private name = '';
  /** A move to another room under way, joining it in the background. */
  private joining: AbortController | null = null;
  /** Smoothed main-thread time spent per frame (simulation, animation, render submission), in ms. */
  frameCpuMs = 0;
  /** The minimap redraws at 30 Hz; dots on a small map look the same and it halves the cost. */
  private minimapTimer = 0;
  /** The frame rate readout, when shown: frames and time since it last updated. */
  private showFps = false;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    world: WorldScene,
    overlay: HTMLElement,
    landing: Landing,
    settings: Settings,
    autoQuality: Quality,
  ) {
    this.world = world;
    this.landing = landing;
    this.settings = settings;
    const canvas = world.renderer.domElement;
    this.input = new Input(canvas);
    this.rig = new CameraRig(world.camera);
    this.labels = new LabelLayer(overlay, world.camera);
    // From inside the walk-in, the kitchen's labels only show through its doorway, and the other way.
    this.labels.hides = (eye, at) =>
      coolerWallBetween(eye.x, eye.y, eye.z, at.x, at.y, at.z, world.cooler.open);
    // The game starts on the landing screen, where labels stay hidden.
    this.labels.element.hidden = true;
    this.hud = new Hud(overlay);
    this.loadout = new Loadout(this.hud.corner);
    this.minimap = new Minimap(
      this.hud.corner,
      world.stations.entries.map((entry) => entry.color),
    );
    this.chat = new Chat(overlay, {
      onSend: (text) => this.multiplayer?.sendChat(text),
      onClose: () => this.closeChat(),
    });
    this.toasts = new Toasts(overlay);
    this.knockout = new Knockout(overlay);
    this.killFeed = new KillFeed(this.hud.feedSlot);
    this.impact = new Impact(overlay);
    this.viewmodel = world.viewmodel;
    this.panel = new InfoPanel(overlay);
    this.pause = new PauseMenu(
      overlay,
      {
        onResume: (look) => void this.resume(look),
        onLeave: () => this.leave(),
        onMove: (room, intent) => this.moveTo(room, intent),
      },
      settings,
      { active: world.quality, auto: autoQuality },
    );
    settings.subscribe((values) => {
      this.input.sensitivity = values.sensitivity;
      this.input.invertY = values.invertY;
      this.rig.baseFov = values.fov;
      this.rig.motion = values.reduceMotion ? 0 : 1;
      this.showFps = values.showFps;
      this.hud.setFps(values.showFps ? 0 : null);
      document.documentElement.classList.toggle('reduce-motion', values.reduceMotion);
      this.multiplayer?.setPrefs(prefsOf(values));
      // Drawn fresh the next time the arm comes into view, as the menu closes.
      this.viewmodel.setLook(values.knife);
      this.loadout.setKnife(values.knife.skin);
    });

    this.world.stations.entries.forEach((entry, i) => {
      const anchor = this.world.stations.anchor(i);
      if (!anchor) return;
      // What the station holds: its section of the resume, never the station's French name.
      const label = el('div', { class: 'lore-label' }, [el('span', { text: entry.title })]);
      // Labels show exactly as far away as the station can be clicked.
      this.stationLabels.push(this.labels.add(label, anchor, 0.55, PICK_DISTANCE, 'yield'));
    });

    // A fist that meets the walk-in's steel door jars the view a little.
    this.cooler = new CoolerControl(world.cooler, this.player, () => this.rig.bump());
    world.knives.onOfflineStuck = (knife) => this.cooler.knifeStuck(knife, this.elapsed);

    this.desk = new ComputerDesk(world.computer, (message) => this.toasts.show(message));
    this.computerGuide = new ComputerGuide(overlay);
    const pcLabel = el('div', { class: 'lore-label' }, [el('span', { text: 'DOOM' })]);
    this.computerLabel = this.labels.add(
      pcLabel,
      new Vector3(COMPUTER.x, COMPUTER.y + 0.08, COMPUTER.z),
      0.3,
      PICK_DISTANCE,
      'yield',
    );
    // The screen faces east, so the cook at it looks west (yaw +90 degrees), level.
    this.computerQuat.setFromEuler(this.euler.set(0, Math.PI / 2, 0));
    window.addEventListener('keydown', this.onComputerKey, true);
    window.addEventListener('keyup', this.onComputerKey, true);
    document.addEventListener('mousemove', this.onComputerMouseMove);
    canvas.addEventListener('mousedown', this.onComputerMouseButton);
    window.addEventListener('mouseup', this.onComputerMouseButton);

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    this.input.onPrimary = () => this.primary();
    this.panel.onClose = (look) => void this.resume(look);
    canvas.addEventListener('click', () => void this.onCanvasClick());
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
      this.mode === 'panel' ||
      this.mode === 'computer'
    );
  }

  /** Called from the landing form submit, which is a user gesture, so pointer lock is allowed. */
  enter(name: string, room: string): void {
    if (this.mode !== 'landing') return;
    this.room = room;
    this.landing.hide();
    this.labels.element.hidden = false;
    this.player.reset();
    this.world.knives.reset([]);
    this.cooler.reset([]);
    this.lastThrowSeq = -Infinity;
    this.setArmed(true);
    this.input.yaw = SPAWN.yaw;
    this.input.pitch = 0;
    this.enterFrom.copy(this.world.camera.position);
    this.enterFromQuat.copy(this.world.camera.quaternion);
    this.enterToQuat.setFromEuler(this.euler.set(0, SPAWN.yaw, 0));
    this.enterProgress = 0;
    this.mode = 'entering';
    this.name = name;
    this.chat.clear();
    this.multiplayer = this.connect(room);
    this.showRoom();
    void this.input.lock();
  }

  /** Be in `room`: connect to it, or take over a connection already joined to it. */
  private connect(room: string, joined?: JoinedRoom): Multiplayer {
    return new Multiplayer(
      {
        url: SERVER_URL,
        name: this.name,
        room,
        prefs: prefsOf(this.settings.values),
        player: this.player,
        avatars: this.world.avatars,
        labels: this.labels,
        hud: this.hud,
        chat: this.chat,
        worldTime: () => this.elapsed,
        knives: this.world.knives,
        notify: (message) => this.toasts.show(message),
        onKill: (thrower, victim, role) => this.onKill(thrower, victim, role),
        onBackOnFeet: () => this.backOnFeet(),
        onFatal: (code) => this.leave(joinFailureMessage(code, room)),
        onStatus: () => this.onConnectionStatus(),
        onSpawn: (yaw) => this.faceSpawn(yaw),
        onCoolerState: (dents) => this.cooler.reset(dents),
        onCoolerHit: (message, wait, own) =>
          this.cooler.serverHit(message, this.elapsed, wait, own),
      },
      joined,
    );
  }

  private faceSpawn(yaw: number): void {
    this.input.yaw = yaw;
    this.input.pitch = 0;
    this.enterToQuat.setFromEuler(this.euler.set(0, yaw, 0));
  }

  /**
   * Move to another room in place, from the pause menu: join it in the background, and only once
   * it has let us in, leave this one, so a full, taken or unreachable room leaves the player where
   * they were. Offline there is nobody to lose, so going back to the lobby just goes.
   * Resolves to null once there, or to why not (empty when there is nothing to say).
   * A move still under way when the menu is closed carries on: it is where the player asked to go.
   */
  private async moveTo(room: string, intent?: RoomIntent): Promise<string | null> {
    const current = this.multiplayer;
    if (!current || !this.inWorld || this.joining) return '';
    if (room === this.room) return `You are already in ${roomName(room)}.`;
    if (!current.isOnline) {
      if (room !== DEFAULT_ROOM) return joinFailureMessage('unreachable', room);
      this.moveInto(room);
      return null;
    }
    const joining = new AbortController();
    this.joining = joining;
    try {
      const joined = await joinRoom(
        {
          url: SERVER_URL,
          name: this.name,
          room,
          intent,
          prefs: prefsOf(this.settings.values),
        },
        joining.signal,
      );
      // Left the world while the new room was letting us in.
      if (joining.signal.aborted) {
        joined.connection.close();
        return null;
      }
      this.moveInto(room, joined);
      return null;
    } catch (error) {
      const failure = error instanceof JoinError ? error.failure : 'unreachable';
      return failure === 'cancelled' ? '' : joinFailureMessage(failure, room);
    } finally {
      if (this.joining === joining) this.joining = null;
    }
  }

  /** Leave this room for `room` and start over there: its spawn, its players, its knives, its chat. */
  private moveInto(room: string, joined?: JoinedRoom): void {
    this.multiplayer?.close();
    this.room = room;
    this.toasts.clear();
    this.chat.clear();
    this.killFeed.clear();
    this.impact.clear();
    this.world.knives.reset([]);
    this.cooler.reset([]);
    this.throwAt = null;
    this.punchPending = false;
    this.lastThrowSeq = -Infinity;
    // Without a welcome to place us, stand at the spawn as when playing solo.
    if (!joined) {
      this.player.reset();
      this.faceSpawn(SPAWN.yaw);
    }
    this.backOnFeet();
    this.multiplayer = this.connect(room, joined);
    this.showRoom();
  }

  /** Show which room this is everywhere it appears: the menu, its invite link, the address bar. */
  private showRoom(): void {
    const party = this.room !== DEFAULT_ROOM;
    const siteRoot = new URL(import.meta.env.BASE_URL, location.origin).href;
    this.pause.setRoom(this.room, party ? inviteLink(this.room, siteRoot) : null);
    // A reload, or the address shared as is, comes back to the same party.
    history.replaceState(history.state, '', addressForRoom(location.href, this.room));
    this.onConnectionStatus();
  }

  /**
   * Keep the menu's status line and party controls in step with the connection. A retry does not
   * make the server any more reachable, so parties stay unavailable, saying why, until it answers.
   */
  private onConnectionStatus(): void {
    const mp = this.multiplayer;
    this.pause.setStatus(this.statusLine());
    this.pause.setPartyAvailability(
      !mp
        ? 'connecting'
        : mp.status === 'online'
          ? 'online'
          : mp.status === 'connecting' && !mp.retrying
            ? 'connecting'
            : mp.versionMismatch
              ? 'updating'
              : 'offline',
    );
  }

  /** Back to the landing screen, optionally explaining why. */
  leave(reason = ''): void {
    // Set the mode first: closing the panel would otherwise try to resume play.
    this.mode = 'landing';
    this.desk.stepAway();
    this.computerGuide.hide();
    this.computerBlend = 0;
    this.hud.setComputer('off');
    this.pause.hide();
    this.panel.close();
    this.chat.hide();
    this.hud.hide();
    this.setCovered(false);
    this.hud.setPrompt(null);
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.unlock();
    this.toasts.clear();
    this.killFeed.clear();
    this.impact.clear();
    this.joining?.abort();
    this.joining = null;
    this.multiplayer?.close();
    this.multiplayer = null;
    this.backOnFeet();
    this.viewmodel.setShown(false);
    this.world.knives.reset([]);
    this.cooler.reset([]);
    this.landing.setNotice(reason);
    // Entering again goes back to the same room, as the address bar says.
    this.landing.setRoom(this.room);
    this.landing.show();
    // Labels would float over the landing card; the world behind it is just scenery.
    this.labels.element.hidden = true;
  }

  /** Menus and panels cover the HUD and the labels, which would otherwise float over them. */
  private setCovered(covered: boolean): void {
    this.hud.setCovered(covered);
    this.labels.element.hidden = covered;
  }

  private beginPlaying(): void {
    this.mode = 'playing';
    this.viewmodel.setShown(!this.knockedOut);
    this.input.enabled = true;
    this.hud.show();
    this.chat.show();
  }

  /**
   * Back to playing from a menu. With `look`, tries pointer lock, and plays unlocked if the browser
   * refuses; without it (closed with Esc) the mouse stays free until the world is clicked.
   */
  private async resume(look: boolean): Promise<void> {
    if (this.mode !== 'paused' && this.mode !== 'panel') return;
    this.pause.hide();
    this.setCovered(false);
    this.mode = 'playing';
    this.input.enabled = true;
    this.viewmodel.setShown(!this.knockedOut);
    if (look) await this.input.lock();
  }

  /** The room and the connection, as the pause menu says it. */
  private statusLine(): string {
    const room = this.room === DEFAULT_ROOM ? 'The lobby' : `Party #${this.room}`;
    const mp = this.multiplayer;
    if (!mp || mp.status === 'offline') return `${room} · Playing solo`;
    if (mp.status === 'connecting') return `${room} · Connecting`;
    const rtt = mp.rtt;
    return `${room} · Online${rtt === null ? '' : ` · ${Math.round(rtt)} ms`}`;
  }

  private openPause(note = ''): void {
    if (this.mode !== 'playing') return;
    this.pause.setStatus(this.statusLine());
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.unlock();
    this.setCovered(true);
    this.viewmodel.setShown(false);
    this.pause.show(note);
  }

  private openPanel(entry: LoreEntry): void {
    this.mode = 'panel';
    this.input.enabled = false;
    this.input.releaseAll();
    this.hud.setPrompt(null);
    this.setCovered(true);
    // The arm would show, dimmed, under the card.
    this.viewmodel.setShown(false);
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

  /**
   * Throw from the eye, after this input's step, as the server will: the knife is drawn at once and
   * the server's version of it, when it arrives, takes over where it ends up.
   */
  private throwKnife(input: InputMessage, online: boolean): void {
    this.lastThrowSeq = input.seq;
    const s = this.player.state;
    const knife = launchKnife(s.x, s.y + EYE_HEIGHT, s.z, input.yaw, input.pitch);
    // Drawn leaving the hand on screen, flying from the eye where it can hit.
    const hand = this.viewmodel.knifeCenter(this.hand);
    this.world.knives.throwOwn(
      input.seq,
      this.multiplayer?.selfId ?? -1,
      knife,
      online,
      hand,
      this.viewmodel.look,
    );
  }

  private onKill(
    thrower: KillParty,
    victim: KillParty,
    role: 'thrower' | 'victim' | 'witness',
  ): void {
    this.killFeed.add(thrower, victim, role !== 'witness');
    if (role === 'victim') this.knockOut(thrower);
    else if (role === 'thrower') this.impact.landed(victim);
  }

  private knockOut(by: KillParty): void {
    if (this.mode === 'computer') this.leaveComputer();
    this.knockedOut = true;
    this.throwAt = null;
    if (this.mode === 'chat') this.chat.close();
    this.impact.hit();
    this.rig.hit();
    this.world.renderer.domElement.classList.add('is-dimmed');
    this.rig.setKnockedOut(true);
    this.viewmodel.setShown(false);
    // Station labels would float over the knockout card.
    this.labels.element.hidden = true;
    // The first time Chef Skinner gets this visitor, say he need not.
    const hint = by.resident && !this.toldAboutChef;
    if (hint) this.toldAboutChef = true;
    this.knockout.show(by, hint ? 'Rather he left you alone? Turn him off in Settings (Esc).' : '');
  }

  private setArmed(armed: boolean): void {
    this.armed = armed;
    this.throwAt = null;
    this.viewmodel.setArmed(armed);
  }

  private backOnFeet(): void {
    if (!this.knockedOut) return;
    this.knockedOut = false;
    this.rig.setKnockedOut(false);
    this.knockout.hide();
    this.world.renderer.domElement.classList.remove('is-dimmed');
    // Leaving the world is not waking up; only blink when play goes on.
    if (this.mode !== 'landing') this.impact.blink();
    this.viewmodel.setShown(this.inWorld);
    this.labels.element.hidden = this.mode !== 'playing' && this.mode !== 'chat';
  }

  private onLockChange(locked: boolean): void {
    if (locked) return;
    // Losing the lock while playing means the player pressed Esc (or the browser took it away).
    if (this.mode === 'chat') {
      this.chat.close();
      this.openPause();
    } else if (this.mode === 'playing') {
      this.openPause();
    } else if (this.mode === 'computer') {
      // Esc, under pointer lock: the browser takes the key, so it means stepping away.
      this.leaveComputer();
    }
  }

  private onKey(code: string): boolean {
    if (this.mode !== 'playing') return false;
    if (code === 'Escape' && !this.input.locked) {
      this.openPause();
    } else if (code === 'Enter' || code === 'NumpadEnter') {
      this.openChat();
    } else if (code === 'KeyQ') {
      if (!this.knockedOut) this.setArmed(!this.armed);
    } else if (code === 'KeyI') {
      if (!this.knockedOut) this.viewmodel.startInspect();
    } else if (code === 'KeyE') {
      const entry = this.world.stations.hoveredEntry;
      if (this.computerHovered && !this.knockedOut) this.useComputer();
      else if (entry) this.openPanel(entry);
    } else {
      return false;
    }
    return true;
  }

  /**
   * A click on the world without pointer lock asks for it, so the click that brings the mouse back
   * does not throw. Where the browser never locks (it cannot, or always refuses), a click throws; a
   * browser that has locked before and refuses now (Chrome does for a moment after Esc) is only
   * asked again on the next click.
   */
  private async onCanvasClick(): Promise<void> {
    if (this.mode !== 'playing' || this.input.locked || !this.input.pressWasClick) return;
    if (!(await this.input.lock()) && !this.input.lockWorks) this.primary();
  }

  /** The left button: with the knife out it throws, with the bare hand out it punches. */
  private primary(): void {
    if (this.mode !== 'playing' || this.knockedOut) return;
    if (this.armed) this.throwWhenReady();
    else this.punchWhenReady();
  }

  /** Start a throw if the knife is up; the tick after the hand lets go launches it. */
  private throwWhenReady(): void {
    if (this.viewmodel.startThrow()) this.throwAt = this.elapsed + THROW.release;
  }

  /** Jab if the hand is up; the next input tells the room, so others see it. */
  private punchWhenReady(): void {
    if (this.viewmodel.startPunch()) {
      this.punchPending = true;
      this.punchAt = this.elapsed;
    }
  }

  private tick(): void {
    const wasGrounded = this.player.state.grounded;
    const fallSpeed = -this.player.state.vy;
    const online = this.multiplayer?.isOnline ?? false;
    // Knocked out: lie still. The server ignores movement then anyway, so prediction agrees.
    let keys = this.knockedOut ? 0 : this.input.keys;
    if (this.armed) keys |= Keys.Armed;
    if (this.punchPending) {
      if (!this.knockedOut && !this.armed) keys |= Keys.Punch;
      this.punchPending = false;
    }
    if (this.throwAt !== null && this.elapsed >= this.throwAt) {
      // The hand has let go: throw on this input, as soon as the server's cooldown allows.
      if (this.knockedOut || !this.armed) this.throwAt = null;
      else if (this.player.nextSeq - this.lastThrowSeq >= KNIFE_COOLDOWN_INPUTS) {
        keys |= Keys.Throw;
        this.throwAt = null;
      }
    }
    const input = this.player.tick(keys, this.input.yaw, this.input.pitch, online);
    if (input.keys & Keys.Throw) this.throwKnife(input, online);
    if (input.keys & Keys.Punch) {
      this.cooler.punched(this.player.state, this.punchAt + PUNCH.hit, !online);
    }
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

    // Holding the button down keeps throwing, as fast as each knife can be drawn, or punching.
    if (this.mode === 'playing' && !this.knockedOut && this.input.firing) {
      if (this.armed) this.throwWhenReady();
      else this.punchWhenReady();
    }
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
    this.cooler.update(this.elapsed);
    const mp = this.multiplayer;
    this.world.knives.update(dt, mp?.knifeTargets() ?? NO_TARGETS, mp?.spares);
    this.updateCamera(dt);
    const color = this.multiplayer?.selfColor;
    if (color) this.viewmodel.setColor(color);
    this.viewmodel.update(
      dt,
      this.world.camera,
      this.input.yaw,
      this.input.pitch,
      this.player.horizontalSpeed,
      this.player.state.grounded,
    );
    this.updateMinimap(dt);
    if (this.showFps) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        this.hud.setFps(Math.round(this.fpsFrames / this.fpsTime));
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
    this.hud.setLookCue(this.mode === 'playing' && !this.input.locked && !this.knockedOut);
    this.loadout.update(this.armed, this.viewmodel.knifeReadiness);
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
      this.landingCamera.update(camera, this.elapsed, this.settings.values.reduceMotion);
      return;
    }
    if (this.mode === 'entering') {
      const s = this.player.state;
      // The first frame plans the swoop from wherever the landing left the camera.
      if (this.enterProgress === 0) {
        this.landingCamera.planSwoop(
          this.enterFrom,
          this.enterFromQuat,
          s.x,
          s.z,
          this.enterToQuat,
        );
      }
      this.enterProgress = Math.min(1, this.enterProgress + dt / this.landingCamera.swoopSeconds);
      this.landingCamera.swoop(camera, this.enterProgress, s.x, s.z, this.enterToQuat);
      if (this.enterProgress >= 1) this.beginPlaying();
      return;
    }
    this.player.renderPosition(this.accumulator / TICK_SECONDS, dt, this.feet);
    const s = this.player.state;
    this.rig.update(
      dt,
      this.feet,
      this.input.yaw,
      this.input.pitch,
      this.player.horizontalSpeed,
      s.grounded,
    );
    this.followComputer(dt);
  }

  /** Glide to the computer's screen while it is in use, and back afterwards. */
  private followComputer(dt: number): void {
    const target = this.mode === 'computer' ? 1 : 0;
    if (this.computerBlend === target) {
      if (target === 0) return;
    } else {
      const step = dt / COMPUTER_GLIDE;
      this.computerBlend =
        target > this.computerBlend
          ? Math.min(1, this.computerBlend + step)
          : Math.max(0, this.computerBlend - step);
    }
    const camera = this.world.camera;
    computerViewpoint(camera.fov, this.computerView);
    const t = easeInOutCubic(this.computerBlend);
    camera.position.lerp(this.computerView, t);
    camera.quaternion.slerp(this.computerQuat, t);
  }

  /** Sit down at the kitchen computer: the keys go to DOOM until Esc. */
  private useComputer(): void {
    this.mode = 'computer';
    this.input.enabled = false;
    this.input.releaseAll();
    this.hud.setComputer('guide');
    this.computerGuide.show();
    this.labels.element.hidden = true;
    this.viewmodel.setShown(false);
    // The mouse turns the marine, so hold on to it; E is a key press, so the browser allows it.
    void this.input.lock();
    void this.desk.use();
  }

  private leaveComputer(): void {
    if (this.mode !== 'computer') return;
    this.desk.stepAway();
    this.computerGuide.hide();
    this.mode = 'playing';
    this.input.enabled = true;
    this.hud.setComputer('off');
    this.labels.element.hidden = false;
    this.viewmodel.setShown(!this.knockedOut);
  }

  /** At the computer, with the mouse held, its motion turns the marine. */
  private readonly onComputerMouseMove = (event: MouseEvent): void => {
    if (this.mode !== 'computer' || !this.input.locked) return;
    this.desk.mouseMove(event.movementX * this.input.sensitivity);
  };

  /** A click at the computer fires; without the mouse held, the first one only takes it back. */
  private readonly onComputerMouseButton = (event: MouseEvent): void => {
    if (this.mode !== 'computer') return;
    const down = event.type === 'mousedown';
    if (down && !this.input.locked) {
      void this.input.lock();
      return;
    }
    if (down) this.putGuideAway();
    this.desk.mouseButton(event.button, down);
  };

  /** The first key or click at the computer puts the controls away; it still reaches DOOM. */
  private putGuideAway(): void {
    if (!this.computerGuide.shown) return;
    this.computerGuide.hide();
    this.hud.setComputer('playing');
  }

  /**
   * At the computer every key goes to DOOM, before the game's own handlers see it, except Esc,
   * which steps away. DOOM's menu, normally on Esc, moves to the backquote key.
   */
  private readonly onComputerKey = (event: KeyboardEvent): void => {
    if (this.mode !== 'computer') return;
    event.preventDefault();
    event.stopPropagation();
    const down = event.type === 'keydown';
    if (event.code === 'Escape') {
      if (down) this.leaveComputer();
      return;
    }
    if (down) this.putGuideAway();
    this.desk.key(event.code === 'Backquote' ? 'Escape' : event.code, down);
  };

  private updateMinimap(dt: number): void {
    if (!this.inWorld) return;
    this.minimapTimer -= dt;
    if (this.minimapTimer > 0) return;
    this.minimapTimer = 1 / 30;
    const mp = this.multiplayer;
    this.minimap.setCoolerOpen(this.world.cooler.open);
    this.minimap.begin();
    mp?.forEachRemote(this.minimap.drawPlayer);
    this.minimap.drawSelf(this.feet.x, this.feet.z, this.input.yaw);
  }

  private updateHover(): void {
    let index = -1;
    let computer = false;
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
      // Nothing in the kitchen can be picked through the walk-in's walls.
      const o = this.ray.origin;
      this.reach.copy(o).addScaledVector(this.ray.direction, PICK_DISTANCE);
      const r = this.reach;
      if (!coolerWallBetween(o.x, o.y, o.z, r.x, r.y, r.z, this.world.cooler.open)) {
        computer = this.desk.picked(this.ray, PICK_DISTANCE);
        if (!computer) index = this.world.stations.pick(this.ray);
      }
    }
    if (index === this.hoveredIndex && computer === this.computerHovered) return;
    if (computer !== this.computerHovered && this.computerLabel) {
      this.computerLabel.element.classList.toggle('is-hovered', computer);
      this.computerLabel.pinned = computer;
    }
    this.computerHovered = computer;
    const previous = this.stationLabels[this.hoveredIndex];
    if (previous) {
      previous.element.classList.remove('is-hovered');
      previous.pinned = false;
    }
    const next = this.stationLabels[index];
    if (next) {
      next.element.classList.add('is-hovered');
      next.pinned = true;
    }
    this.hoveredIndex = index;
    this.world.stations.setHovered(index);
    const entry = this.world.stations.hoveredEntry;
    this.hud.setPrompt(computer ? 'Play DOOM' : entry ? `Open ${entry.title}` : null);
  }
}
