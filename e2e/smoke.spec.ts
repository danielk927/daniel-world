import { expect, test } from '@playwright/test';
import { enterWorld } from './helpers.ts';

test('landing screen loads over the 3D world', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Doyoon (Daniel) Kim' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeEnabled();
  await expect(page.getByLabel('Your name')).not.toHaveValue('');

  // The party code field stays closed until the private party is opened from the bottom row.
  const party = page.getByRole('button', { name: 'Private party' });
  await expect(party).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Private party')).toBeHidden();
  await party.click();
  await expect(party).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Private party')).toBeFocused();
});

test('an invite link opens the private party with its code in', async ({ page }) => {
  await page.goto('/?room=friday-service');
  await expect(page.getByRole('button', { name: 'Private party' })).toHaveAttribute(
    'aria-expanded',
    'true',
    { timeout: 30_000 },
  );
  await expect(page.getByLabel('Private party')).toHaveValue('friday-service');
  await expect(page.locator('#landing-room-help')).toHaveText(
    'You are invited to this party. Clear the code for the public lobby.',
  );
});

test('portfolio page renders every section', async ({ page }) => {
  await page.goto('/portfolio.html');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(9);
});

test('station labels that would overlap give way to the nearer one', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Label Reader', online: false });
  // From the spawn point the rotisseur and poissonnier labels line up behind each other.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
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
          return { shown: boxes.length, overlapping };
        }),
      { message: 'visible station labels should not overlap' },
    )
    .toMatchObject({ shown: expect.any(Number), overlapping: [] });
  await page.context().close();
});
