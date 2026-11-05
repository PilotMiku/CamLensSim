import { expect, test } from '@playwright/test';

test('sunlight independently illuminates a street lamp with its bulb and sky switched off', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const tracerModule = '/node_modules/.vite/deps/three-gpu-pathtracer.js';
    const sceneModule = '/src/renderer/pathTracingScene.ts';
    const fixtureModule = '/src/scenes/fixtures.ts';
    const sunModule = '/src/scenes/sunlight.ts';
    const skyModule = '/src/scenes/afternoonSky.ts';
    const THREE = await import(threeModule), { WebGLPathTracer } = await import(tracerModule);
    const { createPathTracingScene } = await import(sceneModule);
    const { addStreetLamp } = await import(fixtureModule);
    const { addVisibleSun } = await import(sunModule);
    const { OUTDOOR_SUN_DIRECTION: sunDirection } = await import(skyModule);
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(96, 96);
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight('#ffecd0', 4);
    sun.name = 'test-independent-sun'; sun.target.position.set(0, 1.5, 0);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 80);
    scene.add(sun, sun.target); addVisibleSun(scene, sun, 360);
    const lamp = addStreetLamp(scene, [0, 0, 0], 3, [0.65, 0, 0], [1, 0, 1], 0, 12);
    scene.traverse((object: any) => {
      if (object.isMesh && object.material.emissive) object.material.emissiveIntensity = 0;
    });
    const physical = createPathTracingScene({ scene, sunlight: { sun, beam: lamp,
      density: 0.004, distance: 20, groundHeight: 0, heightFalloff: 0.1 }, dispose() {} });
    physical.scene.environment = null; physical.scene.background = new THREE.Color(0);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
    camera.position.copy(sun.target.position).addScaledVector(sunDirection, 6);
    camera.lookAt(0.25, 1.55, 0); camera.updateMatrixWorld(true);
    const tracer = new WebGLPathTracer(renderer);
    tracer.renderToCanvas = false; tracer.renderDelay = 0; tracer.bounces = 3;
    tracer.textureSize.set(64, 64); tracer.tiles.set(1, 1); tracer.stableNoise = true;
    tracer.setScene(physical.scene, camera);
    const tracedSun = physical.scene.getObjectByName(sun.name);
    const readEnergy = async (intensity: number) => {
      tracedSun.intensity = intensity; tracer.updateLights();
      while (tracer.samples < 24) {
        tracer.renderSample();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      const pixels = new Float32Array(96 * 96 * 4);
      renderer.readRenderTargetPixels(tracer.target, 0, 0, 96, 96, pixels);
      let energy = 0;
      for (let i = 0; i < pixels.length; i += 4) energy += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      return energy / (96 * 96);
    };
    const off = await readEnergy(0), on = await readEnergy(4), stronger = await readEnergy(8);
    tracer.dispose(); physical.dispose();
    scene.traverse((object: any) => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    renderer.dispose();
    return { off, on, stronger };
  });
  await test.info().attach('sunlight-energy.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.off).toBeLessThan(0.00001);
  expect(result.on).toBeGreaterThan(0.001);
  expect(result.stronger / result.on).toBeGreaterThan(1.85);
  expect(result.stronger / result.on).toBeLessThan(2.15);
  expect(errors).toEqual([]);
});
