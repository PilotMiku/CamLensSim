import { expect, test } from '@playwright/test';

test('fisheye renders and focuses calibrated off-axis targets on every sensor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const results = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const rendererModule = '/src/renderer/SimulatorRenderer.ts';
    const equipmentModule = '/src/data/equipment.ts';
    const THREE = await import(threeModule);
    const { SimulatorRenderer } = await import(rendererModule);
    const { DEFAULT_PARAMETERS, SENSORS, getLens } = await import(equipmentModule);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '360px', height: '240px', position: 'fixed', top: '0', left: '0' });
    document.body.append(host);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0);
    const geometry = new THREE.SphereGeometry(0.1, 24, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const target = new THREE.Mesh(geometry, material);
    scene.add(target);
    const sim = new SimulatorRenderer(host, {
      cameraNear: 0.01, cameraFar: 100,
      create: () => ({ scene, dispose: () => { geometry.dispose(); material.dispose(); } }),
    }, () => {});
    const results = [];
    try {
      for (const sensor of SENSORS) {
        host.style.height = `${360 * sensor.heightMm / sensor.widthMm}px`;
        for (const [nx, ny] of [[0.8, 0], [0, 0.8], [-0.7, -0.5]]) {
          // Place a small target at the independently derived sensor location.
          const x = nx * sensor.widthMm / 2, y = ny * sensor.heightMm / 2;
          const r = Math.hypot(x, y), theta = 2 * Math.asin(r / 32);
          target.position.set(5 * Math.sin(theta) * x / r, 5 * Math.sin(theta) * y / r, -5 * Math.cos(theta));
          sim.update({ ...DEFAULT_PARAMETERS, focalLengthMm: 16, lensId: 'fisheye-16',
            pose: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 } }, sensor, getLens('fisheye-16'),
            { renderMode: 'realtime', depthOfField: false, quality: 'smooth' });
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          const rt = sim.sceneTarget;
          const pixel = new Uint16Array(4);
          sim.renderer.readRenderTargetPixels(rt, Math.floor((nx + 1) * rt.width / 2), Math.floor((ny + 1) * rt.height / 2), 1, 1, pixel);
          const rect = host.getBoundingClientRect();
          const hit = sim.focusAt(rect.left + (nx + 1) * rect.width / 2, rect.top + (1 - ny) * rect.height / 2);
          results.push({ sensor: sensor.id, nx, ny, red: THREE.DataUtils.fromHalfFloat(pixel[0]),
            hitError: hit ? Math.hypot(hit.point.x - target.position.x, hit.point.y - target.position.y, hit.point.z - target.position.z) : null });
        }
      }
      // Restore the scene's original culling flag when returning to a normal lens.
      sim.update(DEFAULT_PARAMETERS, SENSORS[0], getLens('prime-50'), { renderMode: 'realtime', depthOfField: false, quality: 'smooth' });
      return { results, cullingRestored: target.frustumCulled };
    } finally { sim.dispose(); host.remove(); }
  });
  for (const result of results.results) {
    expect(result.red, JSON.stringify(result)).toBeGreaterThan(0.8);
    expect(result.hitError, JSON.stringify(result)).not.toBeNull();
    expect(result.hitError).toBeLessThan(0.11);
  }
  expect(results.cullingRestored).toBe(true);
  expect(errors).toEqual([]);
});
