import { expect, test } from '@playwright/test';

const poseValue = async (page: import('@playwright/test').Page, key: string) =>
  Number(await page.getByTestId('camera-pose').getAttribute(`data-${key}`));

test('renders real 3D, connects optics to controls, focuses and resets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('horizontal-fov')).toHaveText('39.6°');
  await expect(page.getByTestId('total-dof')).toHaveText(/0\.\d+m/);
  const before = await canvas.screenshot({
    path: `test-results/${test.info().project.name}-default-view.png`,
  });
  await page.getByLabel('光圈', { exact: true }).fill('16');
  await page.getByLabel('光圈', { exact: true }).press('Tab');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'APS-C', exact: true }).click();
  await expect(page.getByTestId('equivalent-focal')).toHaveText('76.7mm');
  await expect(page.getByTestId('horizontal-fov')).toHaveText('26.4°');
  await page.getByLabel('镜头预设').selectOption('prime-85');
  await expect(page.getByLabel('焦距', { exact: true })).toHaveValue('85');
  await expect(page.getByLabel('焦距', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重置参数' }).click();
  await expect(page.getByLabel('焦距', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('光圈', { exact: true })).toHaveValue('1.8');
  // Click the framed print in the background to focus far away.
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error('Missing viewfinder');
  await canvas.click({ position: { x: rect.width * 0.7, y: rect.height * 0.16 } });
  await expect
    .poll(async () => Number(await page.getByLabel('对焦距离', { exact: true }).inputValue()))
    .toBeGreaterThan(4.5);
  await page.getByRole('button', { name: '三分构图线' }).click();
  await expect(page.locator('.composition-grid')).toBeVisible();
  await page.getByRole('button', { name: '景深预览' }).click();
  await expect(page.getByRole('button', { name: '景深预览' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByLabel('渲染质量').selectOption('low');
  await page.getByRole('button', { name: '使用帮助' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.getByRole('button', { name: '重置参数' }).click();
  await expect(page.getByRole('button', { name: '景深预览' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-studio.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('moves and turns the free camera with the keyboard while focus tracks the subject', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  await page.locator('h1').click();
  const focusInput = page.getByLabel('对焦距离', { exact: true });
  const beforeZ = await poseValue(page, 'z');
  const beforeFocus = Number(await focusInput.inputValue());
  await page.keyboard.down('w');
  await expect.poll(async () => poseValue(page, 'z'), { timeout: 8000 }).toBeLessThan(beforeZ - 0.3);
  await page.keyboard.up('w');
  const afterFocus = Number(await focusInput.inputValue());
  expect(afterFocus).toBeLessThan(beforeFocus - 0.25);
  const beforeYaw = await poseValue(page, 'yaw');
  await page.keyboard.down('j');
  await expect
    .poll(async () => poseValue(page, 'yaw'), { timeout: 8000 })
    .toBeGreaterThan(beforeYaw + 10);
  await page.keyboard.up('j');
  await page.keyboard.down('r');
  await expect.poll(async () => poseValue(page, 'y'), { timeout: 8000 }).toBeGreaterThan(1.4);
  await page.keyboard.up('r');

  // Drag-to-look should also rotate the camera.
  const canvas = page.locator('[data-testid="canvas-host"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  const yawBeforeDrag = await poseValue(page, 'yaw');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => poseValue(page, 'yaw')).toBeLessThan(yawBeforeDrag - 5);

  // Reset the rig back to the default framing.
  await page.getByRole('button', { name: '复位机位' }).first().click();
  await expect.poll(async () => poseValue(page, 'z')).toBeGreaterThan(2.8);
  await expect.poll(async () => poseValue(page, 'yaw')).toBeGreaterThan(-1);
});

test('drives the camera with the virtual joysticks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const toggle = page.getByRole('button', { name: '虚拟摇杆' });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const layer = page.getByTestId('joysticks');
  await expect(layer).toBeVisible();
  const beforeZ = await poseValue(page, 'z');
  const pad = page.getByLabel('移动摇杆');
  const box = await pad.boundingBox();
  if (!box) throw new Error('Missing move joystick');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1, { steps: 4 });
  await expect.poll(async () => poseValue(page, 'z'), { timeout: 8000 }).toBeLessThan(beforeZ - 0.2);
  await page.mouse.up();

  const beforeYaw = await poseValue(page, 'yaw');
  const look = page.getByLabel('视角摇杆');
  const lookBox = await look.boundingBox();
  if (!lookBox) throw new Error('Missing look joystick');
  await page.mouse.move(lookBox.x + lookBox.width / 2, lookBox.y + lookBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lookBox.x + lookBox.width * 0.9, lookBox.y + lookBox.height / 2, {
    steps: 4,
  });
  await expect
    .poll(async () => poseValue(page, 'yaw'), { timeout: 8000 })
    .toBeLessThan(beforeYaw - 8);
  await page.mouse.up();
});

test('keeps the optical calculator usable without WebGL', async ({ page }) => {
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
  await page.getByRole('button', { name: 'M4/3', exact: true }).click();
  await expect(page.getByTestId('equivalent-focal')).toHaveText('100.0mm');
  await expect(page.getByRole('status')).toContainText('光学计算与参数调整仍然可用');
});
test('switches scenes and applies special optics', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const scene = page.getByLabel('选择场景');
  const lens = page.getByLabel('镜头预设');
  await scene.selectOption('outdoor');
  await expect(page.locator('.scene-heading h2')).toContainText('室外');
  await lens.selectOption('fisheye-16');
  await expect(page.getByLabel('焦距', { exact: true })).toBeDisabled();
  await expect(page.locator('.optics-detail')).toContainText('鱼眼');
  await lens.selectOption('ts-24');
  await expect(page.getByLabel('倾角', { exact: true })).toBeVisible();
  await expect(page.getByLabel('水平偏移', { exact: true })).toBeVisible();
  await lens.selectOption('mirror-500');
  await expect(page.getByLabel('光圈', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('光圈', { exact: true })).toHaveValue('8.0');
});

test('uses the four reference categories and opens their source images separately', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const picker = page.getByLabel('选择场景');
  await expect(picker.locator('option')).toHaveText(['室内静物', '室外高山湖畔', '室外人像', '林间知更鸟']);
  for (const [id, name] of [['indoor', '室内静物'], ['outdoor', '室外高山湖畔'], ['portrait', '室外人像'], ['animal', '林间知更鸟']]) {
    await picker.selectOption(id);
    await expect(page.locator('.scene-heading h2')).toHaveText(name);
    await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
    await page.getByRole('button', { name: '查看场景参考图' }).click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.getByRole('button', { name: '关闭参考图' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByTestId('image-frame').screenshot({ path: `test-results/${test.info().project.name}-reference-${id}.png` });
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('afternoon sunlight renders in all scenes across quality, depth-of-field and fisheye modes', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  for (const id of ['indoor', 'outdoor', 'portrait', 'animal']) {
    await page.getByLabel('选择场景').selectOption(id);
    await expect(page.locator('.scene-subtitle')).toContainText('CLEAR AFTERNOON 16:00');
    await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
    for (const quality of ['low', 'balanced', 'high']) {
      await page.getByLabel('渲染质量').selectOption(quality);
      await page.getByRole('button', { name: '景深预览' }).click();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.getByTestId('image-frame').screenshot({ path: `test-results/${test.info().project.name}-sunlight-${id}-${quality}.png` });
    }
  }
  const fisheye = await page.getByLabel('镜头预设').locator('option').filter({ hasText: '鱼眼' }).getAttribute('value');
  if (!fisheye) throw new Error('Missing fisheye lens');
  await page.getByLabel('镜头预设').selectOption(fisheye);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.locator('canvas').screenshot();
  expect(errors).toEqual([]);
});

test('path tracing accumulates real samples and returns to interactive rendering', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  await page.getByLabel('渲染质量').selectOption('low');
  await page.getByLabel('渲染模式').selectOption('pathtraced');
  const host = page.getByTestId('canvas-host');
  await expect(host).toHaveAttribute('data-render-mode', 'pathtraced', { timeout: 120_000 });
  await expect.poll(async () => Number(await host.getAttribute('data-path-samples')), { timeout: 120_000 }).toBeGreaterThanOrEqual(28);
  await expect(host).toHaveAttribute('data-path-denoised', 'true');
  await expect(host).toHaveAttribute('data-volumetric-light', 'true');
  await page.getByTestId('image-frame').screenshot({ path: `test-results/${test.info().project.name}-pathtraced.png` });
  await expect(page.getByLabel('渲染质量').locator('option')).toHaveText(['画质', '均衡', '节能']);
  for (const quality of ['high', 'balanced', 'low']) {
    await page.getByLabel('渲染质量').selectOption(quality);
    await expect(page.getByLabel('渲染质量')).toHaveValue(quality);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(async () => Number(await host.getAttribute('data-path-samples')), { timeout: 120_000 }).toBeGreaterThan(1);
    await expect(host).toHaveAttribute('data-render-mode', 'pathtraced');
    await expect(host).toHaveAttribute('data-path-denoised', 'true');
  }
  await page.getByLabel('光圈', { exact: true }).fill('4');
  await page.getByLabel('光圈', { exact: true }).press('Tab');
  await expect.poll(async () => Number(await host.getAttribute('data-path-samples')), { timeout: 120_000 }).toBeGreaterThan(1);
  await page.getByLabel('渲染模式').selectOption('realtime');
  await expect(host).toHaveAttribute('data-render-mode', 'realtime');
  await expect(host).toHaveAttribute('data-path-denoised', 'false');
  await page.getByLabel('镜头预设').selectOption('fisheye-16');
  await page.getByLabel('渲染模式').selectOption('pathtraced');
  await expect(page.getByRole('status')).toContainText('当前镜头使用实时预览');
  await expect(host).toHaveAttribute('data-render-mode', 'realtime');
  expect(errors).toEqual([]);
});

test('plays a focus confirmation on successful focus and respects mute', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    (window as unknown as { focusBeeps: number }).focusBeeps = 0;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = when => {
        (window as unknown as { focusBeeps: number }).focusBeeps++;
        start(when);
      };
      return oscillator;
    };
  });
  await page.goto('/');
  await page.getByLabel('渲染质量').selectOption('low');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  const target = page.locator('.landmark').filter({ hasText: '陶瓶' });
  await target.click();
  const beeps = () => page.evaluate(() => (window as unknown as { focusBeeps: number }).focusBeeps);
  await expect.poll(beeps).toBe(2);
  await page.getByRole('button', { name: '对焦音效', exact: true }).click();
  await expect(page.getByRole('button', { name: '对焦音效', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await target.click();
  expect(await beeps()).toBe(2);
});
