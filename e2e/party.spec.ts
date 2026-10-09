import type { Page } from '@playwright/test';
import {
  enterWorld,
  expect,
  expectWorld,
  type RoomServer,
  startRoomServer,
  test,
  world,
} from './helpers.ts';
import { E2E_CLIENT_URL } from './ports.ts';

let server: RoomServer;

test.beforeAll(async () => {
  server = await startRoomServer();
});

test.afterAll(async () => {
  await server.close();
});

const names = async (page: Page): Promise<string[]> =>
  (await world(page)).remotePlayers.map((p) => p.name).sort();

test('a cook starts a private party from the menu, a friend follows the invite link, and the host goes back to the lobby', async ({
  browser,
}) => {
  const host = await enterWorld(browser, { name: 'Host' });
  await expectWorld(host, (w) => w.playerCount === 2, 'Chef Skinner keeps the lobby company');

  // The menu opens on the Party tab.
  await host.keyboard.press('Escape');
  const menu = host.getByRole('dialog', { name: 'Paused' });
  await expect(menu.getByRole('tab', { name: 'Party' })).toHaveAttribute('aria-selected', 'true');
  await expect(menu.locator('.party-where')).toHaveText('The public lobby');

  // A code with characters a room code cannot have is refused, inline, as it is typed.
  const code = menu.getByLabel('Party code');
  const status = menu.locator('#party-code-status');
  await code.fill('Friday Service!');
  await expect(status).toHaveText('Use only letters, numbers and dashes.');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await code.fill('Friday Service');
  await expect(status).toHaveText('Shared as #friday-service.');
  await menu.getByRole('button', { name: 'Start party' }).click();

  // In place, without a reload: the same page, still in the menu, now in the party, alone.
  const inParty = await expectWorld(
    host,
    (w) => w.room === 'friday-service' && w.connection === 'online' && w.selfId !== null,
    'the host is in the party',
  );
  expect(inParty.mode).toBe('paused');
  expect(inParty.remotePlayers).toEqual([]);
  await expect(menu.locator('.party-where')).toHaveText('#friday-service');
  await expect(host.locator('.hud-room-name')).toHaveText('#friday-service');
  await expect(host).toHaveURL(`${E2E_CLIENT_URL}/?room=friday-service`);
  const invite = menu.getByLabel('Invite link');
  await expect(invite).toHaveValue(`${E2E_CLIENT_URL}/?room=friday-service`);

  // Copy link puts it on the clipboard and says so.
  await host.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: E2E_CLIENT_URL,
  });
  // It says so for a couple of seconds, which a slow page can let pass between two looks, so write
  // down everything the button and the line under it say from before the click.
  const copyButton = menu.getByRole('button', { name: 'Copy link' });
  await copyButton.evaluate((button) => {
    const status = document.getElementById('party-invite-status')!;
    const said: string[] = [];
    (window as unknown as { copySaid: string[] }).copySaid = said;
    new MutationObserver(() => {
      const now = `${button.textContent} / ${status.textContent}`;
      if (said.at(-1) !== now) said.push(now);
    }).observe(button.closest('[role="dialog"]')!, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const copySaid = () =>
    host.evaluate(() => (window as unknown as { copySaid: string[] }).copySaid);
  await copyButton.click();
  await expect
    .poll(copySaid, { message: 'the button and its line say the link is copied' })
    .toContain('Copied / Link copied. Send it to your friends.');
  // And then go back to offering it.
  await expect(copyButton).toBeVisible();
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`${E2E_CLIENT_URL}/?room=friday-service`);

  // A friend follows the link: the landing screen has the party filled in.
  const friend = await enterWorld(browser, { name: 'Friend', path: new URL(link).search });
  const friendState = await expectWorld(
    friend,
    (w) => w.room === 'friday-service' && w.playerCount === 2,
    'the friend is in the party with the host',
  );
  // Just the two of them: no lobby, no Chef Skinner.
  expect(friendState.remotePlayers.map((p) => p.name)).toEqual(['Host']);
  await expectWorld(host, (w) => w.playerCount === 2, 'the host sees the friend arrive');
  expect(await names(host)).toEqual(['Friend']);

  // Back to the lobby, in place: Chef Skinner again, the party gone from the address.
  await menu.getByRole('button', { name: 'Back to the lobby' }).click();
  await expectWorld(
    host,
    (w) =>
      w.room === 'lobby' &&
      w.connection === 'online' &&
      w.remotePlayers.some((p) => p.name === 'Chef Skinner'),
    'the host is back in the lobby with Chef Skinner',
  );
  await expect(host).toHaveURL(`${E2E_CLIENT_URL}/`);
  await expect(menu.locator('.party-where')).toHaveText('The public lobby');
  await expectWorld(friend, (w) => w.playerCount === 1, 'the friend is left alone in the party');

  // Starting a party on a code in use is refused, and the host stays where they are.
  await code.fill('friday-service');
  await menu.getByRole('button', { name: 'Start party' }).click();
  await expect(status).toHaveText(
    'Someone is already using #friday-service. Join them, or pick another code.',
  );
  expect((await world(host)).room).toBe('lobby');
  expect(await names(host)).toContain('Chef Skinner');

  // Joining it works, and play goes on in the party.
  await menu.getByRole('button', { name: 'Join party' }).click();
  await expectWorld(
    host,
    (w) => w.room === 'friday-service' && w.playerCount === 2,
    'the host rejoins the friend',
  );
  expect(await names(host)).toEqual(['Friend']);
  await menu.getByRole('button', { name: 'Resume' }).click();
  await expectWorld(host, (w) => w.mode === 'playing', 'the host plays on in the party');

  await host.context().close();
  await friend.context().close();
});

test('joining a party nobody is in says so, and a random code is easy to start', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Explorer' });
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  const code = menu.getByLabel('Party code');

  await code.fill('nobody-home');
  await menu.getByRole('button', { name: 'Join party' }).click();
  await expect(menu.locator('#party-code-status')).toHaveText(
    'Nobody is in #nobody-home yet. Check the code, or start the party yourself.',
  );
  expect((await world(page)).room).toBe('lobby');

  await menu.getByRole('button', { name: 'Roll a random code' }).click();
  const random = await code.inputValue();
  expect(random).toMatch(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/);
  await code.press('Enter');
  await expectWorld(page, (w) => w.room === random && w.connection === 'online', 'in the party');
  await expect(page).toHaveURL(`${E2E_CLIENT_URL}/?room=${random}`);
  // Focus lands on the next thing to do: sharing the link.
  await expect(menu.getByRole('button', { name: 'Copy link' })).toBeFocused();

  await page.context().close();
});
