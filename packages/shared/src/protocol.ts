import { z } from 'zod';
import { ALL_KEYS, EMOTES, KNIFE_MAX_STUCK, MAX_PITCH } from './constants.ts';

/**
 * Wire protocol. Every message is one JSON object with a `t` discriminator.
 * Both sides parse everything they receive with these schemas and drop anything that fails.
 * Raw string limits are generous; the server sanitizes and trims to the real limits.
 */

const finite = z.number().refine(Number.isFinite, 'must be finite');
const playerId = z.number().int().nonnegative();

// ---------- Client to server ----------

export const helloSchema = z.object({
  t: z.literal('hello'),
  v: z.number().int(),
  name: z.string().max(64),
  room: z.string().max(64),
  /** Where the player was before a reconnect. The server clamps it to the play area. */
  spawn: z.object({ x: finite, z: finite, yaw: finite }).optional(),
});

export const inputSchema = z.object({
  t: z.literal('input'),
  seq: z
    .number()
    .int()
    .nonnegative()
    .max(2 ** 31),
  keys: z.number().int().min(0).max(ALL_KEYS),
  yaw: finite.min(-1e6).max(1e6),
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

export const emoteSendSchema = z.object({
  t: z.literal('emote'),
  emote: z.enum(EMOTES),
});

export const pingSchema = z.object({
  t: z.literal('ping'),
  id: z.number().int().nonnegative(),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  helloSchema,
  inputSchema,
  chatSendSchema,
  emoteSendSchema,
  pingSchema,
]);

export type InputMessage = z.infer<typeof inputSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- Server to client ----------

export const playerInfoSchema = z.object({
  id: playerId,
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
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

export const emoteBroadcastSchema = z.object({
  t: z.literal('emote'),
  id: playerId,
  emote: z.enum(EMOTES),
});

export const pongSchema = z.object({ t: z.literal('pong'), id: z.number().int() });

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

/** A knocked out player is back on their feet somewhere new. */
export const respawnSchema = z.object({ t: z.literal('respawn'), player: playerSnapshotSchema });

export const ERROR_CODES = ['room_full', 'bad_hello', 'version', 'rate_limited'] as const;

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
  emoteBroadcastSchema,
  pongSchema,
  errorSchema,
  knifeThrownSchema,
  knifeStuckSchema,
  killSchema,
  respawnSchema,
]);

export type PlayerInfo = z.infer<typeof playerInfoSchema>;
export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type SnapshotMessage = z.infer<typeof snapshotSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type StuckKnife = z.infer<typeof stuckKnifeSchema>;
export type KnifeThrownMessage = z.infer<typeof knifeThrownSchema>;

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
