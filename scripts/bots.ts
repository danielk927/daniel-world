/**
 * Simulated players for load testing and screenshots.
 *
 *   npm run bots -- --count 14 --room lobby --url ws://localhost:3001 --knives
 *
 * Each bot joins like a browser would, then wanders: it walks, turns, sometimes sprints or jumps,
 * and now and then says something. With --knives they also throw knives every few
 * seconds. Ctrl+C disconnects them all.
 *
 * Bots never take a room's last seat, so you can always join the room they fill: they ask the
 * server how many seats the room has free (it says for the lobby, not for private rooms), then join
 * one at a time and stop one short of full, counting everyone already there, Chef Skinner too.
 * --count is how many you would like, at most MAX_PLAYERS_PER_ROOM - 1 (15).
 */
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import {
  DEFAULT_SERVER_PORT,
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  MAX_PLAYERS_PER_ROOM,
  PROTOCOL_VERSION,
  TICK_MS,
  TICK_RATE,
  encode,
  parseServerMessage,
  type ClientMessage,
} from '@world/shared';

/** One seat in every room stays free, for you. */
const MAX_BOTS = MAX_PLAYERS_PER_ROOM - 1;

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: String(MAX_BOTS) },
    room: { type: 'string', default: 'lobby' },
    url: { type: 'string', default: `ws://localhost:${DEFAULT_SERVER_PORT}` },
    chat: { type: 'boolean', default: true },
    knives: { type: 'boolean', default: false },
  },
});

const asked = Math.max(1, Math.min(MAX_BOTS, Math.floor(Number(values.count)) || MAX_BOTS));
const LINES = ['hi!', 'nice kitchen', 'which station is this?', 'o/', 'yes chef!', 'brb'];

/** Ticks (inputs) in a span of seconds. */
const ticks = (seconds: number): number => Math.round(seconds * TICK_RATE);
/** Ticks until something next happens, between `min` and `max` seconds from now. */
const between = (min: number, max: number): number => ticks(min + Math.random() * (max - min));
/** A press of jump about every two and a half seconds (one in the air does nothing). */
const JUMP_CHANCE = 1 / ticks(2.5);
/** Each tick nudges the heading at random; over a second it wanders about 0.3 radians. */
const WANDER = 0.3 * Math.sqrt(12 / TICK_RATE);
/** Further behind than this (a quarter second) and a bot skips ahead instead of catching up. */
const MAX_CATCH_UP = ticks(0.25);

interface Bot {
  ws: WebSocket;
  seq: number;
  yaw: number;
  keys: number;
  timer: NodeJS.Timeout | null;
  /** Leaving on purpose, so its disconnect is not news. */
  leaving: boolean;
}

/** In the room, with how many players it now holds (residents and this bot included), or not. */
type Joined = { bot: Bot; roomSize: number } | { refused: string };

/**
 * Seats the server says the room has free, or null if it does not say. It publishes the lobby's
 * count only, as `{ players, max }`; whether `max` leaves out Chef Skinner's seat or not, joining
 * checks the room's real size, so this only spares bots that could never get in.
 */
async function freeSeats(): Promise<number | null> {
  const url = new URL(values.url);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${encodeURIComponent(values.room)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { players?: unknown; max?: unknown };
    if (typeof body.players !== 'number' || typeof body.max !== 'number') return null;
    return body.max - body.players;
  } catch {
    return null;
  }
}

function join(index: number): Promise<Joined> {
  return new Promise((resolve) => {
    const ws = new WebSocket(values.url);
    const bot: Bot = {
      ws,
      seq: 0,
      yaw: Math.random() * Math.PI * 2,
      keys: Keys.Forward,
      timer: null,
      leaving: false,
    };
    let settled = false;
    const settle = (result: Joined): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const send = (message: ClientMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(message));
    };

    ws.on('open', () =>
      send({ t: 'hello', v: PROTOCOL_VERSION, name: `Bot ${index + 1}`, room: values.room }),
    );
    ws.on('message', (data: Buffer) => {
      const message = parseServerMessage(data.toString());
      if (message?.t === 'error') settle({ refused: message.code });
      if (message?.t !== 'welcome' || bot.timer) return;
      let nextIntention = 0;
      let nextThrow = between(2, 6);
      const step = (): void => {
        if (bot.seq >= nextIntention) {
          // A new intention every one to three seconds: stand, walk or sprint, maybe say something.
          nextIntention = bot.seq + between(1, 3);
          const roll = Math.random();
          bot.keys = roll < 0.15 ? 0 : Keys.Forward | (roll > 0.8 ? Keys.Sprint : 0);
          if (values.chat && Math.random() < 0.03)
            send({ t: 'chat', text: LINES[Math.floor(Math.random() * LINES.length)]! });
        }
        bot.yaw += (Math.random() - 0.5) * WANDER;
        const jump = Math.random() < JUMP_CHANCE ? Keys.Jump : 0;
        // A knife every two to six seconds, never faster than the cooldown allows.
        const knife = values.knives && bot.seq >= nextThrow ? Keys.Throw : 0;
        if (knife) nextThrow = bot.seq + Math.max(KNIFE_COOLDOWN_INPUTS, between(2, 6));
        const pitch = knife ? (Math.random() - 0.6) * 0.6 : 0;
        const keys = bot.keys | jump | knife | Keys.Armed;
        send({ t: 'input', seq: bot.seq++, keys, yaw: bot.yaw, pitch });
      };
      // One input per tick of time gone by, as a browser's fixed step sends them; a timer alone
      // drifts off the server's 60 Hz. After a stall (a sleeping laptop) it picks up from now
      // rather than sending the backlog in a burst the server would take for a flood.
      let start = performance.now();
      bot.timer = setInterval(() => {
        const due = Math.floor((performance.now() - start) / TICK_MS);
        if (due - bot.seq > MAX_CATCH_UP) start = performance.now() - bot.seq * TICK_MS;
        else while (bot.seq < due) step();
      }, TICK_MS / 2);
      settle({ bot, roomSize: message.players.length });
    });
    ws.on('close', (code: number) => {
      if (bot.timer) clearInterval(bot.timer);
      if (settled && !bot.leaving) console.log(`bot ${index + 1} disconnected (${code})`);
      settle({ refused: `closed (${code})` });
    });
    // A failed connection is followed by a close, which settles it.
    ws.on('error', (error: Error) => console.error(`bot ${index + 1}: ${error.message}`));
  });
}

function leave(bot: Bot | undefined): void {
  if (!bot) return;
  bot.leaving = true;
  bot.ws.close();
}

const bots: Bot[] = [];
process.on('SIGINT', () => {
  for (const bot of bots) leave(bot);
  setTimeout(() => process.exit(0), 200);
});

const free = await freeSeats();
const wanted = free === null ? asked : Math.min(asked, free - 1);
let stopped = '';
for (let i = 0; i < wanted; i++) {
  const joined = await join(i);
  if ('refused' in joined) {
    // Full already (someone else came in, or the server counts seats another way): give one back.
    if (joined.refused === 'room_full') leave(bots.pop());
    stopped = joined.refused;
    break;
  }
  bots.push(joined.bot);
  if (joined.roomSize >= MAX_PLAYERS_PER_ROOM) {
    leave(bots.pop()); // it took the last seat
    break;
  }
  if (joined.roomSize === MAX_PLAYERS_PER_ROOM - 1) break; // one seat left: yours
}

const where = `"${values.room}" at ${values.url}`;
if (bots.length === 0) {
  console.log(`No bots joined ${where}${stopped ? `: ${stopped}` : ': no seat to spare'}.`);
  process.exit(stopped && stopped !== 'room_full' ? 1 : 0);
}
const why = stopped && stopped !== 'room_full' ? `, then a join failed: ${stopped}` : '';
const short = bots.length < asked ? ` (asked for ${asked}${why})` : '';
console.log(`${bots.length} bots in ${where}, one seat left for you${short}. Ctrl+C to stop.`);
