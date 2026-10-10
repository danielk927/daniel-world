import { createServer, connect, type Socket } from 'node:net';
import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { CLOSE_BAD_HELLO, CLOSE_ROOM_FULL, startServer } from '../apps/server/src/server.ts';
import { enterWorld, expectWorld, startRoomServer, walkUntil, world } from './helpers.ts';
import { E2E_SERVER_PORT } from './ports.ts';

/**
 * A TCP relay on the port the client dials, in front of a room server elsewhere, that can go quiet
 * the way a dead network does: nothing gets through either way, and nothing is closed either, so a
 * browser asked to close a socket waits for an answer that never comes.
 */
async function startRelay(target: number) {
  let quiet = false;
  /** Connections the network lost: never heard from again, until `cut` resets them. */
  const lost = new Set<Socket>();
  const live = new Set<{ client: Socket; upstream: Socket }>();
  const server = createServer((client) => {
    client.on('error', () => {});
    if (quiet) {
      // Accepted, then nothing: the opening handshake hangs as it would with no route.
      lost.add(client);
      return;
    }
    const upstream = connect(target, '127.0.0.1');
    upstream.on('error', () => {});
    const pair = { client, upstream };
    live.add(pair);
    client.on('data', (data) => live.has(pair) && upstream.write(data));
    upstream.on('data', (data) => live.has(pair) && client.write(data));
    // A lost connection's end does not get through either.
    const end = () => {
      if (!live.delete(pair)) return;
      client.destroy();
      upstream.destroy();
    };
    client.on('close', end);
    upstream.on('close', end);
  });
  await new Promise<void>((resolve) => server.listen(E2E_SERVER_PORT, '127.0.0.1', resolve));
  return {
    /** The network goes: every connection open now is lost, and new ones get nowhere. */
    goQuiet(): void {
      quiet = true;
      for (const pair of live) lost.add(pair.client);
      live.clear();
    },
    /** The network is back for new connections; the lost ones stay lost. */
    comeBack(): void {
      quiet = false;
    },
    /** The lost connections are reset at last, and the browser hears they are gone. */
    cut(): void {
      for (const socket of lost) socket.destroy();
      lost.clear();
    },
    close(): Promise<void> {
      this.cut();
      for (const pair of live) pair.client.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

test('with the server stopped the world still loads in single-player mode', async ({ browser }) => {
  // No room server is running for this test.
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  const state = await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
  expect(state.playerCount).toBe(1);
  await expect(page.locator('.hud-status')).toHaveText('Solo');

  // The world is fully playable: walking works without a server.
  const before = state.player.x;
  await walkUntil(page, 'KeyA', (p) => p.x < before - 1.5);

  // Parties need the server, and the menu says so rather than failing quietly.
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  const start = menu.getByRole('button', { name: 'Start party' });
  await expect(menu.locator('#party-code-status')).toContainText('The server is unreachable');
  await expect(start).toHaveAttribute('aria-disabled', 'true');

  // When the server comes back, the client reconnects on its own.
  const server = await startRoomServer();
  try {
    await expectWorld(page, (w) => w.connection === 'online', 'should reconnect', 30_000);
    // The menu, still open, opens parties up again.
    await expect(start).toHaveAttribute('aria-disabled', 'false');
    await expect(menu.locator('#party-code-status')).not.toContainText('unreachable');
    await page.keyboard.press('Escape');
    await expect(page.locator('.hud-status')).toContainText('Online');
    // Back in a real room, with an id from the server.
    await expectWorld(page, (w) => w.selfId !== null, 'has a server id');
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('a room server on another protocol version still lets visitors in, solo', async ({
  browser,
}) => {
  // A server from an older or newer deploy: it turns down every hello as the real one does.
  const outdated = new WebSocketServer({ port: E2E_SERVER_PORT, host: '127.0.0.1' });
  outdated.on('connection', (socket) => {
    socket.on('message', () => {
      const error = { t: 'error', code: 'version', message: 'Please reload the page to update.' };
      socket.send(JSON.stringify(error));
      socket.close(CLOSE_BAD_HELLO, 'version');
    });
  });
  const page = await enterWorld(browser, { name: 'Early Bird', online: false });
  try {
    await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
    await expect(page.locator('.hud-status')).toHaveText('Solo · updating');
    // Still in the kitchen, not sent back to the landing screen.
    await page.waitForTimeout(1500);
    await expectWorld(page, (w) => w.mode === 'playing', 'should still be playing');

    // Once the server is redeployed on the same version, the client joins on its own.
    await new Promise<void>((resolve) => outdated.close(() => resolve()));
    const server = await startRoomServer();
    try {
      await expectWorld(page, (w) => w.connection === 'online', 'should connect', 30_000);
    } finally {
      await server.close();
    }
  } finally {
    await page.context().close();
    outdated.close();
  }
});

test('a cook whose room fills up while the server was away keeps cooking solo until it has room', async ({
  browser,
}) => {
  const server = await startRoomServer();
  const page = await enterWorld(browser, { name: 'Regular' });
  try {
    // A blip: the server restarts, and the lobby fills up before this cook gets back in.
    await server.close();
    await expectWorld(page, (w) => w.connection === 'offline', 'solo while the server is away');
    let refused = 0;
    const full = new WebSocketServer({ port: E2E_SERVER_PORT, host: '127.0.0.1' });
    full.on('connection', (socket) => {
      socket.on('message', () => {
        refused++;
        const error = { t: 'error', code: 'room_full', message: 'Room "lobby" is full.' };
        socket.send(JSON.stringify(error));
        socket.close(CLOSE_ROOM_FULL, 'room full');
      });
    });
    try {
      // Turned away, and turned away again on the next try: still in the kitchen, solo, saying why.
      await expect.poll(() => refused, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      const state = await world(page);
      expect(state.mode).toBe('playing');
      expect(state.connection).not.toBe('online');
      await expect(page.locator('.hud-status')).not.toContainText('Online');
      const log = page.getByRole('list', { name: 'Chat history' });
      await expect(log).toContainText('The lobby is full right now');
      // The server answers, so a party can still be started rather than the menu calling it gone.
      await page.keyboard.press('Escape');
      const menu = page.getByRole('dialog', { name: 'Paused' });
      await expect(menu.getByRole('button', { name: 'Start party' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
      await expect(menu.locator('#party-code-status')).not.toContainText('unreachable');
      await page.keyboard.press('Escape');
      await expectWorld(page, (w) => w.mode === 'playing', 'back to cooking');
    } finally {
      await new Promise<void>((resolve) => full.close(() => resolve()));
    }

    // A place frees up: the next try gets in.
    const again = await startRoomServer();
    try {
      await expectWorld(page, (w) => w.connection === 'online', 'back in the lobby', 30_000);
      expect((await world(page)).mode).toBe('playing');
    } finally {
      await again.close();
    }
  } finally {
    await page.context().close();
  }
});

test('a room server address the browser will not even open still lets visitors in, solo', async ({
  browser,
}) => {
  const errors: Error[] = [];
  const page = await enterWorld(browser, {
    name: 'Mixed Content',
    online: false,
    prepare: async (page) => {
      page.on('pageerror', (error) => errors.push(error));
      // As a ws:// address on an https page, or a malformed VITE_SERVER_URL: no socket is made.
      await page.addInitScript(() => {
        window.WebSocket = new Proxy(WebSocket, {
          construct(_target, [url]: unknown[]) {
            throw new DOMException(`Refused to connect to ${String(url)}`, 'SecurityError');
          },
        });
      });
    },
  });
  try {
    await expectWorld(page, (w) => w.connection === 'offline', 'solo, and saying so');
    await expect(page.locator('.hud-status')).toHaveText('Solo');
    // The retries fail the same way, quietly, for as long as the visitor stays.
    await page.waitForTimeout(2500);
    expect((await world(page)).mode).toBe('playing');
    await expect(page.locator('.hud-status')).toHaveText('Solo');

    // Leaving and coming back works, and leaves nothing trying on behind it.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Leave the kitchen' }).click();
    await page.getByRole('button', { name: 'Enter the kitchen' }).click();
    await expectWorld(
      page,
      (w) => w.mode === 'playing' && w.connection === 'offline',
      'solo again',
    );
    await page.waitForTimeout(2500);
    await expect(page.locator('.hud-status')).toHaveText('Solo');
    expect(errors.map((error) => error.message)).toEqual([]);
  } finally {
    await page.context().close();
  }
});

test('a connection the network silently drops turns solo in seconds, and back when it returns', async ({
  browser,
}) => {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const relay = await startRelay(server.port);
  try {
    const page = await enterWorld(browser, { name: 'Commuter', room: 'e2e-tunnel' });
    const { selfId } = await world(page);

    // The train enters a tunnel: no packet gets through, and no socket is closed.
    relay.goQuiet();
    // Snapshots stop, so within the silence timeout the world goes solo, whatever the browser
    // makes of closing the old socket.
    await expectWorld(
      page,
      (w) => w.connection !== 'online',
      'solo once the server goes quiet',
      8000,
    );
    await expect(page.locator('.hud-status')).not.toContainText('Online');
    // Chat says nobody can hear, rather than swallowing the line.
    await page.keyboard.press('Enter');
    await page.keyboard.type('anyone there?');
    await page.keyboard.press('Enter');
    const log = page.getByRole('list', { name: 'Chat history' });
    await expect(log).toContainText('You are offline, so nobody can hear you right now.');

    // Out of the tunnel: the next retry gets through and joins the room again.
    relay.comeBack();
    const back = await expectWorld(
      page,
      (w) => w.connection === 'online' && w.selfId !== null && w.selfId !== selfId,
      'back online with a new connection',
      30_000,
    );
    await expect(page.locator('.hud-status')).toContainText('Online');

    // The lost socket's end reaches the browser at last, and changes nothing.
    relay.cut();
    await page.waitForTimeout(1000);
    const after = await world(page);
    expect(after.connection).toBe('online');
    expect(after.selfId).toBe(back.selfId);
    await page.context().close();
  } finally {
    await relay.close();
    await server.close();
  }
});
