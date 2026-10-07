import { expect, test, type Page } from '@playwright/test';
import { enterWorld, expectWorld, startRoomServer, turnTo, world } from './helpers.ts';

const KARAMBIT = 'karambit/doppler';

/** Choose the Karambit on the Knives page of the pause menu and equip it, with the keyboard. */
async function equipKarambit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  await menu.getByRole('tab', { name: 'Knives' }).click();
  const knives = menu.getByRole('radiogroup', { name: 'Knife' });
  // The chef's knife is equipped and chosen to begin with; the arrow key moves on to the next.
  const chef = knives.getByRole('radio', { name: 'Chef’s Knife' });
  await expect(chef).toHaveAttribute('aria-checked', 'true');
  await chef.focus();
  await page.keyboard.press('ArrowRight');
  const karambit = knives.getByRole('radio', { name: 'Karambit' });
  await expect(karambit).toHaveAttribute('aria-checked', 'true');
  await expect(karambit).toBeFocused();
  await expect(menu.getByRole('heading', { name: 'Karambit' })).toBeVisible();
  await expect(menu.getByRole('radio', { name: 'Doppler' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('button', { name: 'Equip' }).click();
  await expect(menu.getByRole('status')).toContainText('Karambit equipped');
  await expect(menu.getByRole('button', { name: 'Equipped' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Back to the kitchen, where it is drawn.
  await menu.getByRole('button', { name: 'Resume' }).click();
}

test('a cook equips the Karambit, and others see it thrown and stuck, late joiners too', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const server = await startRoomServer();
  try {
    const thrower = await enterWorld(browser, { name: 'Collector', room: 'e2e-skins' });
    const watcher = await enterWorld(browser, { name: 'Watcher', room: 'e2e-skins' });
    await expectWorld(watcher, (w) => w.playerCount === 2, 'the watcher sees the collector');
    expect((await world(watcher)).remotePlayers[0]?.knife).toBe('kitchen/stock');

    await equipKarambit(thrower);
    await expectWorld(
      thrower,
      (w) => w.mode === 'playing' && w.knife.skin === 'karambit' && w.knife.finish === 'doppler',
      'the collector holds the Karambit',
    );
    // It is kept with the settings.
    const stored = await thrower.evaluate(() => localStorage.getItem('world.settings'));
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      knife: { skin: 'karambit', finish: 'doppler' },
    });
    // The room hears of it, so the watcher draws it in the collector's hand.
    await expectWorld(
      watcher,
      (w) => w.remotePlayers[0]?.knife === KARAMBIT,
      'the watcher knows the collector carries the Karambit',
    );

    // Thrown at the floor: the watcher sees a Karambit fly and stick.
    await turnTo(thrower, (await world(thrower)).look.yaw, -1.2);
    await expect
      .poll(
        async () => {
          await thrower.mouse.click(480, 270);
          return (await world(thrower)).knives.flying + (await world(thrower)).knives.stuck;
        },
        { message: 'the collector throws' },
      )
      .toBeGreaterThan(0);
    const seen = await expectWorld(
      watcher,
      (w) => w.knives.stuck === 1 && w.knives.looks[KARAMBIT] === 1,
      'the watcher sees the Karambit stuck in the floor',
    );
    expect(Object.keys(seen.knives.looks)).toEqual([KARAMBIT]);
    await expectWorld(
      thrower,
      (w) => w.knives.looks[KARAMBIT] === 1,
      'the collector sees their own Karambit there too',
    );

    // Someone joining later sees it as it was thrown.
    const latecomer = await enterWorld(browser, { name: 'Latecomer', room: 'e2e-skins' });
    await expectWorld(
      latecomer,
      (w) => w.knives.stuck === 1 && w.knives.looks[KARAMBIT] === 1,
      'the latecomer sees the stuck Karambit',
    );
    for (const page of [thrower, watcher, latecomer]) await page.context().close();
  } finally {
    await server.close();
  }
});
