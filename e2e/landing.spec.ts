import { RESUME_LABEL, RESUME_URL } from '../apps/client/src/resume.ts';
import { enterWorld, expect, followResume, startRoomServer, test } from './helpers.ts';

test('without WebGL the landing says so and makes the resume the way in', async ({ page }) => {
  // A browser or device without WebGL: every canvas refuses a WebGL context.
  await page.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype;
    const getContext = Object.getOwnPropertyDescriptor(prototype, 'getContext')!.value as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl2' || type === 'webgl' ? null : getContext.call(this, type, ...rest);
      },
    });
  });
  await page.goto('/');
  const resume = page.getByRole('link', { name: RESUME_LABEL });
  await expect(resume).toBeVisible({ timeout: 30_000 });
  await expect(resume).toHaveAttribute('href', RESUME_URL);
  await expect(resume).toBeFocused();
  await expect(page.getByText('WebGL 2 is unavailable')).toBeVisible();
  // Nothing that needs the world: no way in, no party, no kitchen built behind the landing.
  await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Private party' })).toBeHidden();
  await expect(page.locator('canvas.world-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.__world === undefined)).toBe(true);
  // Enter, which is where the focus is, goes to the PDF, in this tab: there is no world to keep.
  await followResume(page, () => page.keyboard.press('Enter'), { newTab: false });
});

test('the landing counts the cooks in the lobby as they come and go', async ({ browser, page }) => {
  await page.goto('/');
  const count = page.locator('.landing-count');
  // No room server is running yet.
  await expect(count).toHaveText('Server offline, play solo', { timeout: 30_000 });
  const server = await startRoomServer();
  try {
    // It asks the server every few seconds while the landing shows.
    await expect(count).toHaveText('0 Online', { timeout: 15_000 });
    const cook = await enterWorld(browser, { name: 'Early Bird' });
    await expect(count).toHaveText('1 Online', { timeout: 15_000 });
    await cook.context().close();
    await expect(count).toHaveText('0 Online', { timeout: 15_000 });
  } finally {
    await server.close();
  }
  await expect(count).toHaveText('Server offline, play solo', { timeout: 15_000 });
});
