import { RESUME_LABEL, RESUME_URL } from '../apps/client/src/resume.ts';
import {
  RESUME_FILE,
  enterWorld,
  expect,
  followResume,
  startRoomServer,
  test,
  world,
  type RoomServer,
} from './helpers.ts';

test('the site serves the resume as the PDF in the repo, under the name a saved copy keeps', async ({
  request,
}) => {
  const response = await request.get(RESUME_URL);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/pdf\b/);
  const body = await response.body();
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Not a copy that was changed on its way: the file itself.
  expect(body.equals(RESUME_FILE)).toBe(true);
});

test('the landing links to the resume in a tab of its own, and stays as it was', async ({
  page,
}) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: RESUME_LABEL });
  await expect(link).toBeVisible({ timeout: 30_000 });
  // Said plainly, before the click: a PDF, and a new tab.
  await expect(link).toHaveText('View the resume (PDF)');
  await expect(link).toHaveAttribute('href', RESUME_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  // The generated portfolio page is gone: nothing leads to it.
  await expect(page.locator('a[href*="portfolio"]')).toHaveCount(0);

  await followResume(page, () => link.click(), { newTab: true });
  // The kitchen behind the landing, and the name the visitor typed, are where they were.
  await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/');
});

test.describe('in the kitchen', () => {
  let server: RoomServer;

  test.beforeAll(async () => {
    server = await startRoomServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('the pause menu links to the resume in a tab of its own, and the cook stays in the room', async ({
    browser,
  }) => {
    const page = await enterWorld(browser, { name: 'Reader', room: 'e2e-resume' });
    await page.keyboard.press('Escape');
    const menu = page.getByRole('dialog', { name: 'Paused' });
    await expect(menu).toBeVisible();
    // The Resume that puts the game back is another thing than the resume to read.
    await expect(menu.getByRole('button', { name: 'Resume' })).toBeVisible();
    const link = menu.getByRole('link', { name: RESUME_LABEL });
    await expect(link).toHaveAttribute('href', RESUME_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    await expect(page.locator('a[href*="portfolio"]')).toHaveCount(0);

    await followResume(page, () => link.click(), { newTab: true });

    // Leaving the page would have left the room: it is still here, with the menu open.
    await expect(menu).toBeVisible();
    expect((await world(page)).connection).toBe('online');
    expect((await server.room('e2e-resume'))?.players.map((p) => p.name)).toContain('Reader');
    await page.context().close();
  });
});
