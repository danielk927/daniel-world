/** Server simulation rate. Clients send exactly one input per tick. */
export const TICK_RATE = 20;
export const TICK_SECONDS = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Remote players are rendered this far in the past so there are always two snapshots to blend. */
export const INTERPOLATION_DELAY_MS = 100;

export const PROTOCOL_VERSION = 1;
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

// World bounds.
/** Visual radius of the island top. */
export const ISLAND_RADIUS = 36;
/** Player centers are kept inside this radius (the low wall around the rim). */
export const PLAY_RADIUS = 34;
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
} as const;
export const ALL_KEYS = 63;

export const EMOTES = ['wave', 'dance', 'jump'] as const;
export type Emote = (typeof EMOTES)[number];
/** How long an emote animation plays, in seconds. */
export const EMOTE_DURATION = 2.4;

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
