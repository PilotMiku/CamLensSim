import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const pose = (page: Page) => page.getByTestId('camera-pose');

const holdKey = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  try {
    await page.clock.fastForward(500);
  } finally {
    await page.keyboard.up(key);
  }
  await page.clock.fastForward(1000);
};

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  // Keyboard routing does not need a GPU; exercise the real controls even when
  // the preview is unavailable, keeping these interaction checks inexpensive.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'unavailable');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

test('Space activates focused toolbar buttons without moving the camera', async ({ page }) => {
  const before = await pose(page).getAttribute('data-y');
  const grid = page.getByRole('button', { name: '三分构图线' });
  await grid.focus();
  await holdKey(page, 'Space');
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(pose(page)).toHaveAttribute('data-y', before!);

  await page.getByRole('button', { name: '使用帮助' }).focus();
  await holdKey(page, 'Space');
  await expect(page.getByRole('dialog', { name: '从一束光开始。' })).toBeVisible();
  await expect(pose(page)).toHaveAttribute('data-y', before!);
});

test('camera shortcuts still work after clicking a toolbar button and on the page', async ({ page }) => {
  const grid = page.getByRole('button', { name: '三分构图线' });
  await grid.click();
  await grid.focus();
  await expect(grid).toBeFocused();
  const beforeZ = Number(await pose(page).getAttribute('data-z'));
  await holdKey(page, 'w');
  await expect.poll(async () => Number(await pose(page).getAttribute('data-z')))
    .toBeLessThan(beforeZ - 0.3);

  await page.locator('h1').click();
  const beforeY = Number(await pose(page).getAttribute('data-y'));
  await holdKey(page, 'Space');
  await expect.poll(async () => Number(await pose(page).getAttribute('data-y')))
    .toBeGreaterThan(beforeY + 0.2);
});

test('releasing a movement key after focusing an input stops the camera', async ({ page }) => {
  await page.locator('h1').click();
  const beforeZ = Number(await pose(page).getAttribute('data-z'));
  await page.keyboard.down('w');
  await page.clock.fastForward(500);
  await page.getByLabel('焦距', { exact: true }).focus();
  await page.keyboard.up('w');
  await page.clock.fastForward(2000);
  await expect.poll(async () => Number(await pose(page).getAttribute('data-z')))
    .toBeLessThan(beforeZ - 0.3);
  const stoppedZ = await pose(page).getAttribute('data-z');
  await page.clock.fastForward(2000);
  await expect(pose(page)).toHaveAttribute('data-z', stoppedZ!);
});

test('camera shortcuts respect key events already handled by the page', async ({ page }) => {
  await page.evaluate(() => {
    document.addEventListener('keydown', event => {
      if (event.code === 'KeyW') event.preventDefault();
    });
  });
  await page.locator('h1').click();
  const beforeZ = await pose(page).getAttribute('data-z');
  await holdKey(page, 'w');
  await expect(pose(page)).toHaveAttribute('data-z', beforeZ!);
});
