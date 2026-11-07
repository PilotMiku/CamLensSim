import { expect, test } from '@playwright/test';

test('renders all four quality levels at the advertised native-resolution scale', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const host = page.getByTestId('canvas-host');
  await expect(host).toHaveAttribute('data-status', 'ready');
  const select = page.getByLabel('渲染质量');
  await expect(select.locator('option')).toHaveText(['精细（100%）', '均衡（85%）', '性能（70%）', '流畅（50%）']);
  await expect(select).toHaveValue('balanced');
  const expectedScale: Record<string, number> = { fine: 1, balanced: 0.85, performance: 0.7, smooth: 0.5 };
  for (const quality of ['fine', 'balanced', 'performance', 'smooth', 'fine']) {
    await select.selectOption(quality);
    await expect(host).toHaveAttribute('data-resolution-scale', String(expectedScale[quality]));
    await expect.poll(() => host.evaluate((element, scale) => {
      const canvas = element.querySelector('canvas')!;
      return canvas.width === Math.floor(element.clientWidth * (window.devicePixelRatio * scale))
        && canvas.height === Math.floor(element.clientHeight * (window.devicePixelRatio * scale));
    }, expectedScale[quality])).toBe(true);
  }
  await page.locator('canvas').screenshot();
  expect(errors).toEqual([]);
});
