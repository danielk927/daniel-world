/** Server simulation rate. Clients send exactly one input per tick. */
export const TICK_RATE = 20;
export const TICK_SECONDS = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Remote players are rendered this far in the past so there are always two snapshots to blend. */
export const INTERPOLATION_DELAY_MS = 100;

/** Bump whenever the protocol or the shared simulation changes, so stale clients reload. */
export const PROTOCOL_VERSION = 3;
export const DEFAULT_SERVER_PORT = 3001;

// Rooms and players.
export const DEFAULT_ROOM = 'lobby';
export const MAX_PLAYERS_PER_ROOM = 16;
export const ROOM_CODE_MAX_LENGTH = 24;
export const NAME_MAX_LENGTH = 20;
export const CHAT_MAX_LENGTH = 120;

// Player body.
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
/** Ledges up to this height are walked onto instead of blocking. */
export const STEP_HEIGHT = 0.35;

// Movement tuning (meters, seconds).
export const WALK_SPEED = 5;
export const SPRINT_SPEED = 8.5;
export const JUMP_SPEED = 7.2;
export const GRAVITY = 22;
export const MAX_FALL_SPEED = 40;
export const GROUND_ACCEL = 60;
export const AIR_ACCEL = 12;
/** Collision is resolved this many times per tick so fast movement cannot tunnel. */
export const SIM_SUBSTEPS = 2;

// World bounds: the kitchen is a box, centered on the origin, with its floor at y = 0.
export const ROOM_HALF_X = 8;
export const ROOM_HALF_Z = 6.5;
/** Height of the walls; a barrel vault rises above them. */
export const ROOM_HEIGHT = 3.4;
/** Player centers stay within these extents, so bodies never poke through a wall. */
export const PLAY_HALF_X = ROOM_HALF_X - PLAYER_RADIUS;
export const PLAY_HALF_Z = ROOM_HALF_Z - PLAYER_RADIUS;
export const MIN_Y = -30;
export const MAX_Y = 60;
export const MAX_PITCH = Math.PI / 2 - 0.01;

/** Input key bits, packed into one integer per input message. */
export const Keys = {
  Forward: 1,
  Back: 2,
  Left: 4,
  Right: 8,
  Jump: 16,
  Sprint: 32,
  /** Throw a knife on this input. Set on one input per press, not held. */
  Throw: 64,
} as const;
export const ALL_KEYS = 127;

export const EMOTES = ['wave', 'dance', 'jump'] as const;
export type Emote = (typeof EMOTES)[number];
/** How long an emote animation plays, in seconds. */
export const EMOTE_DURATION = 2.4;

// Knives: every cook carries an endless supply and can throw one with F.
/** Speed a knife leaves the hand at, in meters per second. */
export const KNIFE_SPEED = 18;
/** Knives drop a little on long throws. Lighter than player gravity, which is tuned for jumps. */
export const KNIFE_GRAVITY = 9.81;
/** End-over-end tumble while flying, in radians per second. Only for looks. */
export const KNIFE_SPIN = 16;
/** Shortest time between two throws by one player. */
export const KNIFE_COOLDOWN_MS = 700;
/**
 * The cooldown counted in inputs (one per tick), which is how the server enforces it: catching up a
 * burst of queued inputs in one tick cannot then swallow a throw the client was allowed to make.
 */
export const KNIFE_COOLDOWN_INPUTS = Math.round(KNIFE_COOLDOWN_MS / TICK_MS);
/** A knife that has hit nothing after this long is dropped. */
export const KNIFE_MAX_FLIGHT_SECONDS = 2.5;
/** How deep a knife's tip sinks into whatever it hits. */
export const KNIFE_EMBED = 0.04;
/** Only the newest stuck knives in a room are kept, so the kitchen never fills up. */
export const KNIFE_MAX_STUCK = 60;
/** A knife hits a player when it passes through this cylinder around their feet, toque included. */
export const KNIFE_HIT_RADIUS = 0.42;
export const KNIFE_HIT_HEIGHT = 1.95;
/** A knocked-out cook lies on the floor this long before respawning. */
export const DEATH_SECONDS = 3;
/** A respawned cook cannot be hit for this long. */
export const RESPAWN_PROTECTION_SECONDS = 2;
/** The server rewinds other players at most this far to match what a thrower saw on screen. */
export const MAX_REWIND_MS = 400;

/** One distinct avatar color per player slot in a room. */
export const PLAYER_COLORS = [
  '#ff7a59',
  '#4fb3ff',
  '#7bd88f',
  '#ffcf4d',
  '#c792ea',
  '#ff6fa8',
  '#3dd6c6',
  '#f29e4c',
  '#8c9eff',
  '#b5e655',
  '#ff9e9e',
  '#5ec8e5',
  '#e0a3ff',
  '#ffd9a0',
  '#9be3b5',
  '#f25f5c',
] as const;
