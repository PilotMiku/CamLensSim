import { expect, test } from '@playwright/test';

test('the independent solar model remains visible without a sky, tracks its source and respects occlusion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const sunModule = '/src/scenes/sunlight.ts';
    const THREE = await import(threeModule);
    const { addVisibleSun } = await import(sunModule);
    const size = 96, renderer = new THREE.WebGLRenderer(); renderer.setSize(size, size);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
    const sun = new THREE.DirectionalLight(0xffffff, 4); sun.position.set(0, 0, -10);
    scene.add(sun, sun.target);
    const model = addVisibleSun(scene, sun, 40);
    const camera = new THREE.PerspectiveCamera(4, 1, 0.1, 80);
    const output = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
    const geometry = new THREE.PlaneGeometry(1, 1), material = new THREE.MeshBasicMaterial({ color: 0 });
    const blocker = new THREE.Mesh(geometry, material); blocker.position.z = -2;
    const draw = (x = size / 2) => {
      renderer.setRenderTarget(output); renderer.render(scene, camera);
      const pixel = new Uint16Array(4);
      renderer.readRenderTargetPixels(output, x, size / 2, 1, 1, pixel);
      return THREE.DataUtils.fromHalfFloat(pixel[0]);
    };
    try {
      const on = draw();
      sun.intensity = 0; const off = draw();
      sun.intensity = 4; sun.visible = false; const hidden = draw();
      sun.visible = true; scene.add(blocker); const occluded = draw();
      scene.remove(blocker);
      sun.position.x = 0.1;
      const oldPosition = draw(), shifted = draw(Math.round(size / 2 + size / 2 * 0.01 / Math.tan(2 * Math.PI / 180)));
      sun.position.x = 0; camera.position.set(40, 2, 10); const translated = draw();
      return { on, off, hidden, occluded, oldPosition, shifted, translated,
        separateDisc: model.getObjectByName('solar-disc')?.isMesh === true,
        noSky: scene.environment === null };
    } finally {
      output.dispose(); geometry.dispose(); material.dispose();
      model.traverse((object: any) => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
      renderer.dispose();
    }
  });
  expect(result.separateDisc).toBe(true);
  expect(result.noSky).toBe(true);
  for (const value of [result.on, result.shifted, result.translated]) expect(value).toBeGreaterThan(1000);
  for (const value of [result.off, result.hidden, result.occluded, result.oldPosition]) expect(value).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});
