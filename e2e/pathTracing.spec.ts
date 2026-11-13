import type { Page } from '@playwright/test';
import { expect, pathTracingRenderWidth, test } from './fixtures';
import type { RenderQuality } from '../src/domain/types';
import { RENDER_QUALITY } from '../src/data/renderQuality';

test.use({ renderWidth: pathTracingRenderWidth });

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openTracer(page: Page, quality: RenderQuality = 'smooth') {
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  await page.getByLabel('渲染质量').selectOption(quality);
  await page.getByLabel('渲染模式').selectOption('pathtraced');
}

async function waitForSamples(page: Page, minimum: number) {
  const host = page.getByTestId('canvas-host');
  await expect(host).toHaveAttribute('data-render-mode', 'pathtraced', { timeout: 120_000 });
  await expect.poll(async () => Number(await host.getAttribute('data-path-samples')),
    { timeout: 120_000 }).toBeGreaterThanOrEqual(minimum);
  await expect(host).toHaveAttribute('data-path-denoised', 'true');
}

test('path tracing accumulates 28 real samples and returns to interactive rendering', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await openTracer(page);
  await waitForSamples(page, 28);
  const host = page.getByTestId('canvas-host');
  await expect(host).toHaveAttribute('data-volumetric-light', 'true');
  await page.getByTestId('image-frame').screenshot({ path: `test-results/${test.info().project.name}-pathtraced.png` });
  await expect(page.getByLabel('渲染质量').locator('option')).toHaveText(['精细（100%）', '均衡（85%）', '性能（70%）', '流畅（50%）']);
  await page.getByLabel('渲染模式').selectOption('realtime');
  await expect(host).toHaveAttribute('data-render-mode', 'realtime');
  await expect(host).toHaveAttribute('data-path-denoised', 'false');
  await page.getByLabel('镜头预设').selectOption('fisheye-16');
  await page.getByLabel('渲染模式').selectOption('pathtraced');
  await expect(page.getByRole('status')).toContainText('当前镜头使用实时预览');
  await expect(host).toHaveAttribute('data-render-mode', 'realtime');
  expect(errors).toEqual([]);
});

for (const quality of ['fine', 'balanced', 'performance', 'smooth'] as const) {
  test(`path tracing resets and resumes accumulation when switching to ${quality}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await openTracer(page, quality === 'smooth' ? 'balanced' : 'smooth');
    await waitForSamples(page, 2);
    const host = page.getByTestId('canvas-host');
    const generation = Number(await host.getAttribute('data-path-generation'));
    expect(generation).toBeGreaterThan(0);
    await page.getByLabel('渲染质量').selectOption(quality);
    await expect(page.getByLabel('渲染质量')).toHaveValue(quality);
    // Wait for an actual tracer reset. Old samples must not satisfy this test
    // while the new framebuffer/camera configuration is still pending.
    await expect.poll(async () => Number(await host.getAttribute('data-path-generation')),
      { timeout: 120_000 }).toBeGreaterThan(generation);
    await waitForSamples(page, 2);
    await expect.poll(() => host.evaluate((element, scale) => {
      const canvas = element.querySelector('canvas')!;
      return canvas.width === Math.floor(element.clientWidth * (window.devicePixelRatio * scale))
        && canvas.height === Math.floor(element.clientHeight * (window.devicePixelRatio * scale));
    }, RENDER_QUALITY[quality].resolutionScale)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('path tracing resets and resumes accumulation after an aperture change', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await openTracer(page);
  await waitForSamples(page, 2);
  const host = page.getByTestId('canvas-host');
  const generation = Number(await host.getAttribute('data-path-generation'));
  expect(generation).toBeGreaterThan(0);
  await page.getByLabel('光圈', { exact: true }).fill('4');
  await page.getByLabel('光圈', { exact: true }).press('Tab');
  await expect.poll(async () => Number(await host.getAttribute('data-path-generation')),
    { timeout: 120_000 }).toBeGreaterThan(generation);
  await waitForSamples(page, 2);
  expect(Number(await page.getByLabel('光圈', { exact: true }).inputValue())).toBe(4);
  expect(errors).toEqual([]);
});
