/**
 * Simulated players for load testing and screenshots.
 *
 *   npm run bots -- --count 15 --room lobby --url ws://localhost:3001
 *
 * Each bot joins like a browser would, then wanders: it walks, turns, sometimes sprints or jumps,
 * and now and then emotes or says something. Ctrl+C disconnects them all.
 */
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import {
  DEFAULT_SERVER_PORT,
  EMOTES,
  Keys,
  PROTOCOL_VERSION,
  TICK_MS,
  encode,
  parseServerMessage,
  type ClientMessage,
} from '@world/shared';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '15' },
    room: { type: 'string', default: 'lobby' },
    url: { type: 'string', default: `ws://localhost:${DEFAULT_SERVER_PORT}` },
    chat: { type: 'boolean', default: true },
  },
});

const count = Math.max(1, Math.min(64, Number(values.count)));
const LINES = [
  'hi!',
  'nice island',
  'where is the about page?',
  'o/',
  'this fountain is cool',
  'brb',
];

interface Bot {
  ws: WebSocket;
  seq: number;
  yaw: number;
  keys: number;
  timer: NodeJS.Timeout | null;
}

function startBot(index: number): Bot {
  const ws = new WebSocket(values.url);
  const bot: Bot = {
    ws,
    seq: 0,
    yaw: Math.random() * Math.PI * 2,
    keys: Keys.Forward,
    timer: null,
  };
  const send = (message: ClientMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(message));
  };

  ws.on('open', () =>
    send({ t: 'hello', v: PROTOCOL_VERSION, name: `Bot ${index + 1}`, room: values.room }),
  );
  ws.on('message', (data: Buffer) => {
    const message = parseServerMessage(data.toString());
    if (message?.t !== 'welcome' || bot.timer) return;
    let ticksUntilChange = 0;
    bot.timer = setInterval(() => {
      if (--ticksUntilChange <= 0) {
        // Pick a new intention every one to three seconds.
        ticksUntilChange = 20 + Math.floor(Math.random() * 40);
        const roll = Math.random();
        bot.keys = roll < 0.15 ? 0 : Keys.Forward | (roll > 0.8 ? Keys.Sprint : 0);
        if (Math.random() < 0.08)
          send({ t: 'emote', emote: EMOTES[Math.floor(Math.random() * EMOTES.length)]! });
        if (values.chat && Math.random() < 0.03)
          send({ t: 'chat', text: LINES[Math.floor(Math.random() * LINES.length)]! });
      }
      bot.yaw += (Math.random() - 0.5) * 0.25;
      const jump = Math.random() < 0.02 ? Keys.Jump : 0;
      send({ t: 'input', seq: bot.seq++, keys: bot.keys | jump, yaw: bot.yaw, pitch: 0 });
    }, TICK_MS);
  });
  ws.on('close', (code: number) => {
    if (bot.timer) clearInterval(bot.timer);
    console.log(`bot ${index + 1} disconnected (${code})`);
  });
  ws.on('error', (error: Error) => console.error(`bot ${index + 1}: ${error.message}`));
  return bot;
}

const bots = Array.from({ length: count }, (_, i) => startBot(i));
console.log(`${count} bots joining "${values.room}" at ${values.url}. Ctrl+C to stop.`);

process.on('SIGINT', () => {
  for (const bot of bots) bot.ws.close();
  setTimeout(() => process.exit(0), 200);
});
