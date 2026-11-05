import { expect, test } from '@playwright/test';
import { RESUME_LABEL, RESUME_URL } from '../apps/client/src/resume.ts';
import { enterWorld, followResume } from './helpers.ts';

test('the intro shows who Daniel is, with the resume and the game, before the kitchen loads', async ({
  page,
}) => {
  await page.goto('/');
  const intro = page.getByRole('main');
  await expect(intro.getByRole('heading', { name: 'Doyoon (Daniel) Kim' })).toBeVisible();
  await expect(intro.getByText('CS + Statistics @ UChicago')).toBeVisible();
  await expect(intro.getByRole('listitem')).toHaveCount(6);
  await expect(intro.getByRole('link', { name: RESUME_LABEL })).toHaveAttribute('href', RESUME_URL);
  // The kitchen builds behind it, and the landing shows once asked for, the intro fading out.
  await page.getByRole('button', { name: 'Play the game' }).click();
  await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(intro).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Doyoon (Daniel) Kim' })).toBeVisible();
  await expect(page.getByLabel('Your name')).not.toHaveValue('');

  // The party code field stays closed until the private party is opened from the bottom row.
  const party = page.getByRole('button', { name: 'Private party' });
  await expect(party).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('textbox', { name: 'Party code' })).toBeHidden();
  await party.click();
  await expect(party).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('textbox', { name: 'Party code' })).toBeFocused();
});

test('on a phone the resume is the way in, and the game a quiet second choice', async ({
  browser,
}) => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  await page.goto('/');
  const resume = page.getByRole('link', { name: RESUME_LABEL });
  await expect(resume).toBeVisible({ timeout: 30_000 });
  await expect(resume).toHaveAttribute('href', RESUME_URL);
  // The way in on a phone, where the kitchen has no touch controls: the PDF in this tab, and Back comes home.
  await expect(resume).not.toHaveAttribute('target', /.*/);
  await expect(resume).toHaveClass(/button-primary/);
  await expect(resume).toBeFocused();
  await expect(page.getByRole('main').getByText('made for a keyboard and mouse')).toBeVisible();
  // Still there for a tablet with a keyboard, but not the main action.
  const play = page.getByRole('button', { name: 'Play the game' });
  await expect(play).toBeVisible();
  await expect(play).not.toHaveClass(/button-primary/);
  await followResume(page, () => resume.tap(), { newTab: false });
  await phone.close();
});

test('a kitchen that fails to load says so and offers the resume, on a desktop or a phone', async ({
  browser,
}) => {
  for (const device of [
    {},
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // A deploy lands while the page loads: the game's code it asks for is gone.
    await page.route(/\/assets\/game-[^/]*\.js$/, (route) => route.abort());
    await page.goto('/');
    // A desktop builds the kitchen behind the intro by itself; a phone only once asked.
    if (device.hasTouch) await page.getByRole('button', { name: 'Play the game' }).tap();
    await expect(page.locator('.intro-note')).toContainText('did not load', { timeout: 30_000 });
    const resume = page.getByRole('link', { name: RESUME_LABEL });
    await expect(resume).toBeVisible();
    await expect(resume).toHaveCount(1);
    await expect(resume).toHaveAttribute('href', RESUME_URL);
    await expect(resume).toBeFocused();
    await expect(page.getByRole('button', { name: 'Play the game' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeHidden();
    await expect(page.locator('#loading')).toHaveCount(0);
    expect(errors.length).toBeGreaterThan(0);
    // It is the way in: no tab of its own, since there is no kitchen to come back to.
    await expect(resume).not.toHaveAttribute('target', /.*/);
    await followResume(page, () => resume.click(), { newTab: false });
    await context.close();
  }
});

test('an invite link opens the private party with its code in', async ({ page }) => {
  await page.goto('/?room=friday-service');
  await page.getByRole('button', { name: 'Play the game' }).click();
  await expect(page.getByRole('button', { name: 'Private party' })).toHaveAttribute(
    'aria-expanded',
    'true',
    { timeout: 30_000 },
  );
  await expect(page.getByRole('textbox', { name: 'Party code' })).toHaveValue('friday-service');
  await expect(page.locator('#landing-room-help')).toHaveText(
    'You are invited to this party. Clear the code for the public lobby.',
  );
});

test('without JavaScript the intro is all there is, with the resume, a PDF', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Doyoon (Daniel) Kim' })).toBeVisible();
  // By its class: Playwright's text matching skips what is inside a noscript.
  await expect(page.locator('noscript .intro-note')).toContainText('needs JavaScript');
  // The game does nothing without scripts, so it is not offered.
  await expect(page.getByRole('button', { name: 'Play the game' })).toBeHidden();
  const resume = page.getByRole('link', { name: RESUME_LABEL });
  await expect(resume).toHaveAttribute('href', RESUME_URL);
  // Clicked as a visitor would, so nothing may lie over it.
  await followResume(page, () => resume.click({ timeout: 5_000 }), { newTab: false });
  await context.close();
});

test('station labels that would overlap give way to the nearer one', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Label Reader', online: false });
  // From the spawn point the rotisseur's label (Projects) and the poissonnier's (Research)
  // line up behind each other: one of them shows, and nothing it shows over.
  const pair = ['Projects', 'Research'];
  await expect
    .poll(
      () =>
        page.evaluate((names) => {
          const boxes = [...document.querySelectorAll<HTMLElement>('.lore-label')]
            .filter((label) => Number(label.style.opacity) > 0)
            .map((label) => ({ text: label.textContent, box: label.getBoundingClientRect() }));
          const overlapping: string[] = [];
          for (const [i, a] of boxes.entries()) {
            for (const b of boxes.slice(i + 1)) {
              const apart =
                a.box.right <= b.box.left ||
                b.box.right <= a.box.left ||
                a.box.bottom <= b.box.top ||
                b.box.bottom <= a.box.top;
              if (!apart) overlapping.push(`${a.text} / ${b.text}`);
            }
          }
          const shown = boxes.map((box) => box.text);
          return { pairShown: shown.some((text) => names.includes(text)), shown, overlapping };
        }, pair),
      { message: 'one of the pair shows, and no showing labels overlap' },
    )
    .toMatchObject({ pairShown: true, overlapping: [] });
  await page.context().close();
});
