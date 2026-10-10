import { z } from 'zod';
import { ALL_KEYS, KNIFE_MAX_STUCK, MAX_PITCH } from './constants.ts';
import { COOLER_HITS_TO_OPEN } from './cooler.ts';
import { KNIFE_FINISHES, KNIFE_SKINS } from './skins.ts';
import { COOLER_DOOR } from './world.ts';

/**
 * Wire protocol. Every message is one JSON object with a `t` discriminator.
 * Both sides parse everything they receive with these schemas and drop anything that fails.
 * Raw string limits are generous; the server sanitizes and trims to the real limits.
 */

const finite = z.number().refine(Number.isFinite, 'must be finite');
const playerId = z.number().int().nonnegative();
/**
 * Which way a cook faces, as a client sends it: not wrapped, so it can run well past a turn, but
 * never this far (a million radians), where wrapping it would lose every digit that matters.
 */
const turn = finite.min(-1e6).max(1e6);

/**
 * A knife's look, as optional fields: absent is the chef's knife as it comes, and a knife or finish
 * this version does not know (a newer client's) is dropped rather than refusing the message. Read
 * them with `knifeLook`, which also settles a finish the knife does not come in.
 */
const lookShape = {
  skin: z.enum(KNIFE_SKINS).optional().catch(undefined),
  finish: z.enum(KNIFE_FINISHES).optional().catch(undefined),
};

// ---------- Client to server ----------

/** What a visitor has chosen about the room for themselves, in the hello and on every change. */
export const prefsSchema = z.object({
  /** Chef Skinner, the kitchen's resident cook, may throw knives at this player. */
  chef: z.boolean(),
  /** The knife this player carries, which everyone sees in their hand and wherever it lands. */
  ...lookShape,
});

export type Prefs = z.infer<typeof prefsSchema>;

/** A visitor who has not said otherwise (an older client) gets the room as it comes. */
export const DEFAULT_PREFS: Readonly<Prefs> = { chef: true };

export function samePrefs(a: Readonly<Prefs>, b: Readonly<Prefs>): boolean {
  return (Object.keys(prefsSchema.shape) as (keyof Prefs)[]).every((key) => a[key] === b[key]);
}

/** Someone in the room, as far as Chef Skinner is concerned. */
export interface Cook {
  /** Chef Skinner himself. */
  readonly resident?: boolean | undefined;
  readonly prefs: Readonly<Prefs>;
}

/**
 * Chef Skinner and a cook who has turned him off are out of each other's game: their knives pass
 * through each other. The server decides hits with this, and every screen replays them with it.
 */
export function chefSpares(a: Cook, b: Cook): boolean {
  return (a.resident === true && !b.prefs.chef) || (b.resident === true && !a.prefs.chef);
}

export const helloSchema = z.object({
  t: z.literal('hello'),
  v: z.number().int(),
  name: z.string().max(64),
  room: z.string().max(64),
  /** Where the player was before a reconnect. The server clamps it to the play area. */
  spawn: z.object({ x: finite, z: finite, yaw: turn }).optional(),
  /** Absent means DEFAULT_PREFS. */
  prefs: prefsSchema.optional(),
  /**
   * Why a private room is being entered: `start` a new party (refused if the code is in use) or
   * `join` one (refused if nobody is there). Without it the room is joined, or made if new, as
   * links and reconnects need. The lobby is always joined. Optional, so a server that predates it
   * just joins, and older clients never see the refusals.
   */
  intent: z.enum(['start', 'join']).optional(),
});

export const inputSchema = z.object({
  t: z.literal('input'),
  seq: z
    .number()
    .int()
    .nonnegative()
    .max(2 ** 31),
  keys: z.number().int().min(0).max(ALL_KEYS),
  yaw: turn,
  pitch: finite.min(-MAX_PITCH - 0.01).max(MAX_PITCH + 0.01),
  /**
   * The server tick (fractional) other players were drawn at when this input was made. Lets the
   * server check a thrown knife against where its thrower saw everyone.
   */
  view: finite.nonnegative().optional(),
});

export const chatSendSchema = z.object({
  t: z.literal('chat'),
  text: z.string().max(500),
});

export const pingSchema = z.object({
  t: z.literal('ping'),
  id: z.number().int().nonnegative(),
});

/** The visitor changed their prefs; they apply at once. */
export const prefsMessageSchema = z.object({
  t: z.literal('prefs'),
  prefs: prefsSchema,
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  helloSchema,
  inputSchema,
  chatSendSchema,
  pingSchema,
  prefsMessageSchema,
]);

export type InputMessage = z.infer<typeof inputSchema>;
export type RoomIntent = NonNullable<z.infer<typeof helloSchema>['intent']>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- Server to client ----------

export const playerInfoSchema = z.object({
  id: playerId,
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** Lives in the room, driven by the server (Chef Skinner); absent for visitors. */
  resident: z.literal(true).optional(),
  /** Everyone's prefs are public, so every screen can replay knives as the server flies them. */
  prefs: prefsSchema,
});

/** Full simulation state of one player, as sent in snapshots. */
export const playerSnapshotSchema = z.object({
  id: playerId,
  x: finite,
  y: finite,
  z: finite,
  vx: finite,
  vy: finite,
  vz: finite,
  yaw: finite,
  pitch: finite,
  grounded: z.boolean(),
  /** Knocked out by a knife, lying on the floor until they respawn. */
  dead: z.boolean(),
  /** Holding a knife (rather than the bare hand). */
  armed: z.boolean(),
  /** Sequence number of the last input from this player that the server has applied. */
  ack: z.number().int(),
});

const knifeId = z.number().int().nonnegative();
const unit = finite.min(-1.0001).max(1.0001);

/** A knife stuck in a surface: where its tip is, and the way the blade points into it. */
export const stuckKnifeSchema = z.object({
  id: knifeId,
  x: finite,
  y: finite,
  z: finite,
  dx: unit,
  dy: unit,
  dz: unit,
  /** The knife as its thrower carried it, so it stays itself after they change or leave. */
  ...lookShape,
});

/** Where a hit landed on the walk-in's door, and what by: every screen dents it there. */
export const coolerDentSchema = z.object({
  z: finite.min(COOLER_DOOR.from).max(COOLER_DOOR.to),
  y: finite.min(COOLER_DOOR.bottom).max(COOLER_DOOR.top),
  by: z.enum(['fist', 'knife']),
});

/** The walk-in's door so far: every hit it has taken, oldest first. It is open after the tenth. */
export const coolerStateSchema = z.object({
  dents: z.array(coolerDentSchema).max(COOLER_HITS_TO_OPEN),
});

export const welcomeSchema = z.object({
  t: z.literal('welcome'),
  v: z.number().int(),
  id: playerId,
  room: z.string(),
  tick: z.number().int(),
  players: z.array(playerInfoSchema),
  self: playerSnapshotSchema,
  /** Knives already stuck around the room, oldest first. */
  knives: z.array(stuckKnifeSchema).max(KNIFE_MAX_STUCK),
  /** The walk-in's door. Absent means nobody has touched it. Open already means open at once. */
  cooler: coolerStateSchema.optional(),
});

export const joinSchema = z.object({ t: z.literal('join'), player: playerInfoSchema });
export const leaveSchema = z.object({ t: z.literal('leave'), id: playerId });

export const snapshotSchema = z.object({
  t: z.literal('snap'),
  tick: z.number().int(),
  players: z.array(playerSnapshotSchema),
});

export const chatBroadcastSchema = z.object({
  t: z.literal('chat'),
  id: playerId,
  name: z.string(),
  text: z.string(),
});

export const pongSchema = z.object({ t: z.literal('pong'), id: z.number().int() });

/** A player changed their prefs. */
export const prefsChangedSchema = z.object({
  t: z.literal('prefs'),
  id: playerId,
  prefs: prefsSchema,
});

/** Someone punched with the bare hand. A punch hits nobody, though it can dent the walk-in's door. */
export const punchSchema = z.object({ t: z.literal('punch'), id: playerId });

/**
 * A knife left someone's hand, from their eye at this velocity. Every client replays the flight with
 * the shared simulation. `seq` is the input that threw it, so the thrower can match its own.
 */
export const knifeThrownSchema = z.object({
  t: z.literal('knife'),
  id: knifeId,
  from: playerId,
  seq: z.number().int().nonnegative(),
  x: finite,
  y: finite,
  z: finite,
  vx: finite,
  vy: finite,
  vz: finite,
  /** The knife the thrower carried when it left their hand. */
  ...lookShape,
});

/** A knife stuck where it landed, `at` seconds into its flight. */
export const knifeStuckSchema = z.object({
  t: z.literal('stuck'),
  knife: stuckKnifeSchema,
  at: finite.nonnegative(),
});

/** A knife hit `to`, `at` seconds into its flight, and knocked them out. */
export const killSchema = z.object({
  t: z.literal('kill'),
  knife: knifeId,
  from: playerId,
  to: playerId,
  at: finite.nonnegative(),
});

/**
 * Someone's punch or knife hit the walk-in's door. A knife's dent shows when that knife, `at`
 * seconds into its flight, arrives on screen. The hit that bursts the door open also names
 * `openFrom`, the first of the recipient's own inputs whose step sees the doorway open: a little
 * ahead of what they have sent, so their prediction and the server agree on it.
 */
export const coolerHitSchema = z.object({
  t: z.literal('cooler'),
  from: playerId,
  dent: coolerDentSchema,
  knife: z.object({ id: knifeId, at: finite.nonnegative() }).optional(),
  openFrom: z.number().int().nonnegative().optional(),
});

/** A knocked out player is back on their feet somewhere new. */
export const respawnSchema = z.object({ t: z.literal('respawn'), player: playerSnapshotSchema });

export const ERROR_CODES = [
  'room_full',
  'room_taken',
  'no_room',
  'bad_hello',
  'version',
  'rate_limited',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorSchema = z.object({
  t: z.literal('error'),
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('t', [
  welcomeSchema,
  joinSchema,
  leaveSchema,
  snapshotSchema,
  chatBroadcastSchema,
  punchSchema,
  prefsChangedSchema,
  pongSchema,
  errorSchema,
  knifeThrownSchema,
  knifeStuckSchema,
  killSchema,
  respawnSchema,
  coolerHitSchema,
]);

export type PlayerInfo = z.infer<typeof playerInfoSchema>;
export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type SnapshotMessage = z.infer<typeof snapshotSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type StuckKnife = z.infer<typeof stuckKnifeSchema>;
export type KnifeThrownMessage = z.infer<typeof knifeThrownSchema>;
export type CoolerState = z.infer<typeof coolerStateSchema>;
export type CoolerHitMessage = z.infer<typeof coolerHitSchema>;

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

/** Parse and validate a message from a client. Returns null for anything invalid. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  return parseWith(clientMessageSchema, raw);
}

/** Parse and validate a message from the server. Returns null for anything invalid. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  return parseWith(serverMessageSchema, raw);
}

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
