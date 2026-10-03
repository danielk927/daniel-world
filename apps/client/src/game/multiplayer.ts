import type { Vector3 } from 'three';
import {
  INTERPOLATION_DELAY_MS,
  TICK_MS,
  TAG_MIN_PLAYERS,
  type Emote,
  type GameStateMessage,
  type InputMessage,
  type PlayerInfo,
  type ServerMessage,
  type WelcomeMessage,
} from '@world/shared';
import { Connection, type ConnectionStatus } from '../net/connection.ts';
import { ServerClock, SnapshotBuffer } from '../net/interpolation.ts';
import type { Chat } from '../ui/chat.ts';
import { el } from '../ui/dom.ts';
import type { Hud, HudPlayer } from '../ui/hud.ts';
import type { Label, LabelLayer } from '../ui/labels.ts';
import type { Scoreboard, ScoreboardPlayer } from '../ui/scoreboard.ts';
import type { Avatars, AvatarPose } from '../world/avatars.ts';
import type { LocalPlayer } from './localPlayer.ts';

const BUBBLE_MS = 6000;
const EMOTE_LABELS: Record<Emote, string> = {
  wave: 'waves',
  dance: 'dances',
  jump: 'jumps for joy',
};

interface Remote {
  readonly info: PlayerInfo;
  readonly buffer: SnapshotBuffer;
  readonly pose: AvatarPose;
  lastX: number;
  lastZ: number;
  hasPose: boolean;
  /** Latest authoritative position, exposed for tests. */
  readonly server: { x: number; y: number; z: number };
  label: Label | null;
  readonly tag: HTMLElement;
  readonly bubble: HTMLElement;
  bubbleTimer: number;
}

export interface MultiplayerDeps {
  url: string;
  name: string;
  room: string;
  player: LocalPlayer;
  avatars: Avatars;
  labels: LabelLayer;
  hud: Hud;
  chat: Chat;
  scoreboard: Scoreboard;
  /** Seconds, the same clock the world animates with. */
  worldTime: () => number;
  notify: (message: string) => void;
  onFatal: (message: string) => void;
  /** The server placed us somewhere new (first join); turn the view to match. */
  onSpawn: (yaw: number) => void;
}

export interface RemoteDebugInfo {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Everything about being in a room with other people: the connection, reconciling the local player,
 * interpolating and drawing remote players, name tags, chat and emotes.
 */
export class Multiplayer {
  readonly room: string;
  selfId: number | null = null;
  private selfInfo: PlayerInfo | null = null;
  private readonly connection: Connection;
  private readonly remotes = new Map<number, Remote>();
  private readonly clock = new ServerClock();
  private readonly deps: MultiplayerDeps;
  /** Online right now, as far as the chat log is concerned. */
  private wasOnline = false;
  private hasBeenOnline = false;
  /** Whether the chat has explained the version mismatch, so it says so only once. */
  private toldAboutMismatch = false;
  private statusTimer = 0;
  /** The running round of tag, if any. */
  game: GameStateMessage | null = null;

  constructor(deps: MultiplayerDeps) {
    this.deps = deps;
    this.room = deps.room;
    deps.hud.setRoom(deps.room);
    this.refreshPlayers();
    this.connection = new Connection(
      deps.url,
      deps.name,
      deps.room,
      () => {
        // Rejoin where we are standing after a reconnect instead of back at a spawn point.
        if (!this.hasBeenOnline) return undefined;
        const s = deps.player.state;
        return { x: s.x, z: s.z, yaw: s.yaw };
      },
      {
        onStatus: (status, retryInMs) => this.onStatus(status, retryInMs),
        onWelcome: (welcome) => this.onWelcome(welcome),
        onMessage: (message) => this.onMessage(message),
        onFatal: (message) => deps.onFatal(message),
      },
    );
  }

  get status(): ConnectionStatus {
    return this.connection.status;
  }

  get isOnline(): boolean {
    return this.connection.isOnline;
  }

  get rtt(): number | null {
    return this.connection.rtt;
  }

  /** Called once per simulation tick with the input that was just predicted. */
  sendInput(input: InputMessage): void {
    this.connection.send(input);
  }

  sendChat(text: string): void {
    if (!this.isOnline) {
      this.deps.chat.addSystem('You are offline, so nobody can hear you right now.');
      return;
    }
    this.connection.send({ t: 'chat', text });
  }

  sendEmote(emote: Emote): void {
    this.connection.send({ t: 'emote', emote });
  }

  /** Ask the server to start a round of tag. Returns a reason if it clearly cannot start. */
  startTag(): string | null {
    if (!this.isOnline) return 'Tag needs a connection to the server.';
    if (this.game) return 'A round is already running.';
    if (this.remotes.size + 1 < TAG_MIN_PLAYERS)
      return 'Tag needs at least two players. Share the invite link!';
    this.connection.send({ t: 'game', action: 'start' });
    return null;
  }

  close(): void {
    window.clearInterval(this.statusTimer);
    this.endGame();
    this.connection.close();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
  }

  remotePlayers(): RemoteDebugInfo[] {
    return [...this.remotes.values()].map((r) => ({
      id: r.info.id,
      name: r.info.name,
      color: r.info.color,
      x: r.server.x,
      y: r.server.y,
      z: r.server.z,
    }));
  }

  /** Per frame: interpolate every remote player ~100 ms in the past and pose their avatar. */
  update(now: number, dt: number): void {
    this.renderTime = this.clock.serverTime(now) - INTERPOLATION_DELAY_MS;
    this.frameDt = dt;
    this.frameTime = this.deps.worldTime();
    this.remotes.forEach(this.updateRemote);
  }

  private renderTime = 0;
  private frameDt = 0;
  private frameTime = 0;

  /** Visit every remote player's interpolated position (for the minimap). Allocation free. */
  forEachRemote(visit: (id: number, x: number, z: number, color: string) => void): void {
    this.remoteVisitor = visit;
    this.remotes.forEach(this.visitRemote);
  }

  private remoteVisitor: ((id: number, x: number, z: number, color: string) => void) | null = null;
  private readonly visitRemote = (remote: Remote, id: number): void => {
    if (remote.hasPose) this.remoteVisitor?.(id, remote.pose.x, remote.pose.z, remote.info.color);
  };

  /** Bound once, so the per-frame loop allocates nothing. */
  private readonly updateRemote = (remote: Remote, id: number): void => {
    if (!remote.buffer.sample(this.renderTime, remote.pose)) return;
    const pose = remote.pose;
    const dt = this.frameDt;
    if (remote.hasPose && dt > 0) {
      const speed = Math.hypot(pose.x - remote.lastX, pose.z - remote.lastZ) / dt;
      pose.speed += (speed - pose.speed) * Math.min(1, dt * 12);
    }
    remote.lastX = pose.x;
    remote.lastZ = pose.z;
    remote.hasPose = true;
    this.deps.avatars.update(id, pose, this.frameTime, dt);
  };

  private onStatus(status: ConnectionStatus, retryInMs: number | null): void {
    const { hud, chat } = this.deps;
    window.clearInterval(this.statusTimer);
    if (status === 'online') {
      const showPing = (): void => {
        const rtt = this.connection.rtt;
        hud.setStatus('online', rtt === null ? 'Online' : `Online · ${Math.round(rtt)} ms`);
      };
      showPing();
      this.statusTimer = window.setInterval(showPing, 1000);
      return;
    }
    if (status === 'connecting') {
      hud.setStatus('connecting', 'Connecting…');
      return;
    }
    // Offline: everyone else vanishes, the world keeps working in single player.
    this.endGame();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.selfId = null;
    this.clock.reset();
    this.refreshPlayers();
    if (this.wasOnline) {
      chat.addSystem('Lost connection to the server. Playing solo until it is back.');
      this.wasOnline = false;
    }
    const mismatch = this.connection.versionMismatch;
    if (mismatch && !this.toldAboutMismatch) {
      chat.addSystem(
        'Multiplayer is on a different version of the site right now, so you are cooking solo. You will join the others as soon as it matches; if this lasts, reload the page.',
      );
      this.toldAboutMismatch = true;
    }
    const retryAt = performance.now() + (retryInMs ?? 0);
    const show = (): void => {
      const seconds = Math.max(0, Math.ceil((retryAt - performance.now()) / 1000));
      if (mismatch) hud.setStatus('offline', 'Offline · solo mode · multiplayer is updating');
      else
        hud.setStatus(
          'offline',
          seconds > 0
            ? `Offline · solo mode · retrying in ${seconds}s`
            : 'Offline · solo mode · retrying…',
        );
    };
    show();
    this.statusTimer = window.setInterval(show, 500);
  }

  private onWelcome(welcome: WelcomeMessage): void {
    this.selfId = welcome.id;
    this.endGame();
    this.deps.player.reset(welcome.self);
    if (!this.hasBeenOnline) this.deps.onSpawn(welcome.self.yaw);
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    for (const info of welcome.players) {
      if (info.id === welcome.id) this.selfInfo = info;
      else this.addRemote(info);
    }
    this.refreshPlayers();
    const others = welcome.players.length - 1;
    this.deps.chat.addSystem(
      others === 0
        ? `You joined ${welcome.room}. Nobody else is here yet.`
        : `You joined ${welcome.room} with ${others} ${others === 1 ? 'other cook' : 'other cooks'}.`,
    );
    if (this.hasBeenOnline) this.deps.notify('Reconnected');
    this.hasBeenOnline = true;
    this.wasOnline = true;
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'snap': {
        const now = performance.now();
        const serverTime = message.tick * TICK_MS;
        this.clock.observe(serverTime, now);
        for (const s of message.players) {
          if (s.id === this.selfId) {
            this.deps.player.reconcile(s);
            continue;
          }
          const remote = this.remotes.get(s.id);
          if (!remote) continue;
          remote.buffer.push(serverTime, s);
          remote.server.x = s.x;
          remote.server.y = s.y;
          remote.server.z = s.z;
        }
        return;
      }
      case 'join':
        if (message.player.id === this.selfId) return;
        this.addRemote(message.player);
        this.refreshPlayers();
        this.deps.chat.addSystem(`${message.player.name} joined`);
        return;
      case 'leave': {
        const remote = this.remotes.get(message.id);
        if (!remote) return;
        this.removeRemote(message.id);
        this.refreshPlayers();
        this.deps.chat.addSystem(`${remote.info.name} left`);
        return;
      }
      case 'chat': {
        const color =
          message.id === this.selfId
            ? (this.selfInfo?.color ?? '#ffffff')
            : (this.remotes.get(message.id)?.info.color ?? '#ffffff');
        this.deps.chat.addMessage(message.name, color, message.text);
        const remote = this.remotes.get(message.id);
        if (remote) this.showBubble(remote, message.text);
        return;
      }
      case 'emote': {
        const remote = this.remotes.get(message.id);
        if (!remote) return;
        this.deps.avatars.playEmote(message.id, message.emote, this.deps.worldTime());
        this.deps.chat.addSystem(`${remote.info.name} ${EMOTE_LABELS[message.emote]}`);
        return;
      }
      case 'game':
        this.onGameState(message);
        return;
      case 'tagged': {
        const from = this.lookup(message.from)?.name ?? 'Someone';
        const to = this.lookup(message.to)?.name ?? 'someone';
        this.deps.chat.addSystem(`${from} tagged ${to}!`);
        if (message.to === this.selfId) this.deps.notify("🏃 You're it!");
        else if (message.from === this.selfId) this.deps.notify(`Tagged ${to}!`);
        return;
      }
      default:
        return;
    }
  }

  private onGameState(state: GameStateMessage): void {
    const { chat, scoreboard, avatars, notify } = this.deps;
    const started = this.game === null && state.phase === 'playing';
    this.game = state.phase === 'playing' ? state : null;
    scoreboard.update(state, this.selfId, (id) => this.lookup(id));
    const it = state.phase === 'playing' ? state.it : null;
    avatars.setMarked(it);
    for (const [id, remote] of this.remotes) remote.tag.classList.toggle('is-it', id === it);
    if (started) {
      const who = it === this.selfId ? 'You are' : `${this.lookup(it ?? -1)?.name ?? 'Someone'} is`;
      chat.addSystem(`A round of tag started! ${who} it.`);
      if (it === this.selfId) notify("🏃 You're it! Tag someone.");
    } else if (state.phase === 'ended') {
      const top = state.scores[0];
      const winner = top ? this.lookup(top.id)?.name : null;
      chat.addSystem(
        winner ? `Round over. ${winner} wins with ${top!.score} points.` : 'Round over.',
      );
    }
  }

  /** Forget any round in progress (left the room, went offline, rejoined). */
  private endGame(): void {
    this.game = null;
    this.deps.scoreboard.hide();
    this.deps.avatars.setMarked(null);
    for (const remote of this.remotes.values()) remote.tag.classList.remove('is-it');
  }

  private lookup(id: number): ScoreboardPlayer | null {
    if (id === this.selfId) {
      return {
        name: this.selfInfo?.name ?? this.deps.name,
        color: this.selfInfo?.color ?? '#fff8f0',
      };
    }
    const remote = this.remotes.get(id);
    return remote ? { name: remote.info.name, color: remote.info.color } : null;
  }

  private addRemote(info: PlayerInfo): void {
    if (this.remotes.has(info.id)) return;
    const anchor: Vector3 | null = this.deps.avatars.add(info.id, info.color);
    const bubble = el('span', { class: 'nametag-bubble', attrs: { hidden: '' } });
    const tag = el('div', { class: 'nametag' }, [
      bubble,
      el('span', { class: 'nametag-name', text: info.name }),
    ]);
    tag.style.setProperty('--player-color', info.color);
    const remote: Remote = {
      info,
      buffer: new SnapshotBuffer(),
      pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, grounded: true, speed: 0 },
      lastX: 0,
      lastZ: 0,
      hasPose: false,
      server: { x: 0, y: 0, z: 0 },
      label: anchor ? this.deps.labels.add(tag, anchor, 0, 40) : null,
      tag,
      bubble,
      bubbleTimer: 0,
    };
    this.remotes.set(info.id, remote);
  }

  private removeRemote(id: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    window.clearTimeout(remote.bubbleTimer);
    if (remote.label) this.deps.labels.remove(remote.label);
    this.deps.avatars.remove(id);
    this.remotes.delete(id);
  }

  private showBubble(remote: Remote, text: string): void {
    remote.bubble.textContent = text;
    remote.bubble.hidden = false;
    // The tag changed size, so station labels must see its new outline.
    if (remote.label) remote.label.measured = false;
    window.clearTimeout(remote.bubbleTimer);
    remote.bubbleTimer = window.setTimeout(() => {
      remote.bubble.hidden = true;
      if (remote.label) remote.label.measured = false;
    }, BUBBLE_MS);
  }

  private refreshPlayers(): void {
    const players: HudPlayer[] = [];
    const selfName = this.selfInfo?.name ?? this.deps.name;
    const selfColor = this.selfInfo?.color ?? '#fff8f0';
    players.push({ id: this.selfId ?? -1, name: selfName, color: selfColor, isSelf: true });
    for (const r of this.remotes.values()) {
      players.push({ id: r.info.id, name: r.info.name, color: r.info.color, isSelf: false });
    }
    this.deps.hud.setPlayers(players);
  }
}
