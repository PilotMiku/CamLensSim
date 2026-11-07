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
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    const sim = new SimulatorRenderer(host, {
      cameraNear: 0.01, cameraFar: 100,
      create: () => ({ scene, sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 },
        dispose: () => { geometry.dispose(); material.dispose(); } }),
    }, () => {});
    const results = [];
    try {
      for (const sensor of SENSORS) {
        host.style.height = `${360 * sensor.heightMm / sensor.widthMm}px`;
        for (const [nx, ny] of [[0.8, 0], [0, 0.8], [-0.7, -0.5], [0.95, 0.95], [-0.95, 0.95]]) {
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
          results.push({ sensor: sensor.id, nx, ny, behind: target.position.z > 0, distanceM: hit?.distanceM,
            red: THREE.DataUtils.fromHalfFloat(pixel[0]),
            hitError: hit ? Math.hypot(hit.point.x - target.position.x, hit.point.y - target.position.y, hit.point.z - target.position.z) : null });
        }
      }
      // Exercise cached shader variants on repeated projection changes.
      const switched = [];
      target.position.set(0, 0, -5);
      for (const lensId of ['prime-50', 'fisheye-16', 'prime-50']) {
        sim.update({ ...DEFAULT_PARAMETERS, lensId, focalLengthMm: lensId === 'prime-50' ? 50 : 16,
          pose: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 } }, SENSORS[0], getLens(lensId),
        { renderMode: 'realtime', depthOfField: false, quality: 'smooth' });
        sim.renderFrame();
        const rt = sim.sceneTarget, pixel = new Uint16Array(4);
        sim.renderer.readRenderTargetPixels(rt, Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, pixel);
        switched.push(THREE.DataUtils.fromHalfFloat(pixel[0]));
      }
      return { results, switched, cullingRestored: target.frustumCulled };
    } finally { sim.dispose(); host.remove(); }
  });
  for (const result of results.results) {
    expect(result.red, JSON.stringify(result)).toBeGreaterThan(0.8);
    expect(result.hitError, JSON.stringify(result)).not.toBeNull();
    expect(result.hitError).toBeLessThan(0.11);
    expect(result.distanceM).toBeCloseTo(4.9, 1);
  }
  expect(results.results.filter(result => result.behind).length).toBeGreaterThanOrEqual(2);
  expect(results.cullingRestored).toBe(true);
  expect(results.switched.every(value => value > 0.8)).toBe(true);
  expect(errors).toEqual([]);
});

test('fisheye rear-hemisphere depth supports DOF, occlusion and radial clipping', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const rendererModule = '/src/renderer/SimulatorRenderer.ts';
    const equipmentModule = '/src/data/equipment.ts';
    const THREE = await import(threeModule);
    const { SimulatorRenderer } = await import(rendererModule);
    const { DEFAULT_PARAMETERS, SENSORS, getLens } = await import(equipmentModule);
    const sensor = SENSORS.find((s: { id: string }) => s.id === 'medium-format');
    const host = document.createElement('div');
    Object.assign(host.style, { width: '360px', height: `${360 * sensor.heightMm / sensor.widthMm}px`,
      position: 'fixed', top: '0', left: '0' });
    document.body.append(host);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    const geometry = new THREE.SphereGeometry(0.18, 48, 32);
    const green = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const nearObject = new THREE.Mesh(geometry, green), farObject = new THREE.Mesh(geometry, red);
    scene.add(nearObject, farObject);
    const nx = 0.9, ny = 0.9, x = nx * sensor.widthMm / 2, y = ny * sensor.heightMm / 2;
    const r = Math.hypot(x, y), theta = 2 * Math.asin(r / 32);
    const direction = new THREE.Vector3(Math.sin(theta) * x / r, Math.sin(theta) * y / r, -Math.cos(theta));
    const sim = new SimulatorRenderer(host, { cameraNear: 0.1, cameraFar: 8,
      create: () => ({ scene, sunlight: { sun, density: 0, distance: 8, groundHeight: 0, heightFalloff: 0 },
        dispose: () => { geometry.dispose(); green.dispose(); red.dispose(); } }),
    }, () => {});
    const draw = () => {
      sim.update({ ...DEFAULT_PARAMETERS, focalLengthMm: 16, lensId: 'fisheye-16', aperture: 2.8,
        focusDistanceM: 2.82, pose: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 } }, sensor, getLens('fisheye-16'),
      { renderMode: 'realtime', depthOfField: true, quality: 'fine' });
      sim.renderFrame();
      const rt = sim.sceneTarget, coc = sim.cocTarget, pixel = new Uint16Array(4), blur = new Uint16Array(4);
      sim.renderer.readRenderTargetPixels(rt, Math.floor((nx + 1) * rt.width / 2), Math.floor((ny + 1) * rt.height / 2), 1, 1, pixel);
      sim.renderer.readRenderTargetPixels(coc, Math.floor((nx + 1) * coc.width / 2), Math.floor((ny + 1) * coc.height / 2), 1, 1, blur);
      const rect = host.getBoundingClientRect();
      const hit = sim.focusAt(rect.left + (nx + 1) * rect.width / 2, rect.top + (1 - ny) * rect.height / 2);
      return { red: THREE.DataUtils.fromHalfFloat(pixel[0]), green: THREE.DataUtils.fromHalfFloat(pixel[1]),
        coc: THREE.DataUtils.fromHalfFloat(blur[0]), depth: THREE.DataUtils.fromHalfFloat(blur[1]), hitDistance: hit?.distanceM ?? null };
    };
    try {
      nearObject.position.copy(direction).multiplyScalar(3); farObject.position.copy(direction).multiplyScalar(6);
      const occluded = draw();
      scene.remove(nearObject); const unoccluded = draw();
      farObject.position.copy(direction).multiplyScalar(9); const clippedFar = draw();
      farObject.position.copy(direction).multiplyScalar(0.05); farObject.scale.setScalar(0.05); const clippedNear = draw();
      return { behind: direction.z > 0, occluded, unoccluded, clippedFar, clippedNear };
    } finally { sim.dispose(); host.remove(); }
  });
  expect(result.behind).toBe(true);
  expect(result.occluded.green).toBeGreaterThan(0.8);
  expect(result.occluded.red).toBeLessThan(0.01);
  expect(result.occluded.depth).toBeCloseTo(2.82, 1);
  expect(Math.abs(result.occluded.coc)).toBeLessThan(0.1);
  expect(result.occluded.hitDistance).toBeCloseTo(2.82, 2);
  expect(result.unoccluded.red).toBeGreaterThan(0.8);
  expect(result.unoccluded.green).toBeLessThan(0.01);
  expect(result.unoccluded.depth).toBeCloseTo(5.82, 1);
  expect(result.unoccluded.coc).toBeGreaterThan(result.occluded.coc);
  for (const frame of [result.clippedNear, result.clippedFar]) {
    expect(frame.red + frame.green).toBeLessThan(0.01);
    expect(frame.hitDistance).toBeNull();
  }
  expect(errors).toEqual([]);
});
