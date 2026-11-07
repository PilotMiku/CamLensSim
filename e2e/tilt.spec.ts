import { expect, test } from '@playwright/test';

test('tilted CoC shader agrees with the thin-lens model across tilt, shift and infinity', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const maxError = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const opticsModule = '/src/optics/calculate.ts';
    const shaderModule = '/src/renderer/depthOfField.ts';
    const THREE = await import(threeModule);
    const { tiltFocusModel, signedTiltBlurMm } = await import(opticsModule);
    const { cocShader } = await import(shaderModule);
    const renderer = new THREE.WebGLRenderer();
    const size = 8, near = 0.08, far = 1000;
    const pixels = new Float32Array(size * size * 4);
    const depthPixels = new Float32Array(4);
    const depth = new THREE.DataTexture(depthPixels, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
    const material = new THREE.ShaderMaterial({ ...cocShader, uniforms: {
      tDepth: { value: depth }, texel: { value: new THREE.Vector2() },
      nearPlane: { value: near }, farPlane: { value: far }, focalMm: { value: 24 },
      aperture: { value: 3.5 }, inverseFocusM: { value: 0 }, sensorWidthMm: { value: 36 },
      diffractionMm: { value: 0 }, fullWidthPx: { value: 36 }, focusGradientPerM: { value: 0 },
      imageDistanceMm: { value: 24 }, shiftY: { value: 0 }, vFovRad: { value: Math.PI / 6 },
    } });
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    let maxError = 0;
    try {
      for (const tilt of [-2, 0, 2]) for (const focus of [3, Infinity])
        for (const shift of [-0.6, 0, 0.6]) for (const object of [3, Infinity]) {
          const model = tiltFocusModel(24, focus, tilt);
          depthPixels.fill(object === Infinity ? 1 : far * (object - near) / (object * (far - near)));
          depth.needsUpdate = true;
          material.uniforms.inverseFocusM.value = model.inverseFocusM;
          material.uniforms.focusGradientPerM.value = model.gradientPerM;
          material.uniforms.imageDistanceMm.value = model.imageDistanceMm;
          material.uniforms.shiftY.value = shift;
          renderer.setRenderTarget(target); renderer.render(scene, camera);
          renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const slope = (2 * (y + 0.5) / size - 1 + shift) * Math.tan(Math.PI / 12);
            const expected = signedTiltBlurMm(24, 3.5, focus, tilt, object, slope) / 2;
            const actual = pixels[4 * (y * size + x)];
            if (!Number.isFinite(actual)) return Infinity;
            maxError = Math.max(maxError, Math.abs(actual - expected));
          }
        }
      return maxError;
    } finally { geometry.dispose(); material.dispose(); target.dispose(); depth.dispose(); renderer.dispose(); }
  });
  expect(maxError).toBeLessThan(1e-5);
  await page.getByLabel('镜头预设').selectOption('ts-24');
  await page.getByRole('button', { name: '自动跟焦', exact: true }).click();
  await page.getByLabel('对焦距离', { exact: true }).fill('3');
  await page.getByLabel('对焦距离', { exact: true }).press('Tab');
  await page.getByLabel('倾角', { exact: true }).fill('1');
  await page.getByLabel('倾角', { exact: true }).press('Tab');
  await expect(page.locator('.optics-readout')).toContainText('光轴截面景深');
  await expect(page.locator('.optics-readout')).toContainText('零倾角超焦距参考');
  await expect(page.locator('.optics-detail')).toContainText('焦平面倾角');
  await expect(page.getByLabel('景深距离示意')).toContainText('倾斜景深呈楔形');
  expect(errors).toEqual([]);
});
