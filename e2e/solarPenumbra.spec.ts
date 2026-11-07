import { expect, test } from '@playwright/test';

test('solar penumbrae grow with occluder gap in raster and path tracing', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const tracerModule = '/node_modules/.vite/deps/three-gpu-pathtracer.js';
    const sceneModule = '/src/renderer/pathTracingScene.ts';
    const shadowModule = '/src/renderer/solarShadow.ts';
    const THREE = await import(threeModule);
    const { WebGLPathTracer } = await import(tracerModule);
    const { createPathTracingScene } = await import(sceneModule);
    const { patchSolarShadow } = await import(shadowModule);
    const width = 256, height = 64;
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(width, height);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
    const sun = new THREE.DirectionalLight(0xffffff, 4); sun.name = 'test-finite-sun';
    sun.position.set(0, 10, 0); sun.castShadow = true; scene.add(sun, sun.target);
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 20 });
    sun.shadow.bias = -0.00001;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    material.onBeforeCompile = (shader: any) => patchSolarShadow(shader, sun);
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), material);
    receiver.receiveShadow = true; scene.add(receiver);
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide }));
    blocker.position.set(-10, 0.25, 0); blocker.castShadow = true; scene.add(blocker);
    // Oblique viewing rays clear the occluder while seeing its shadow on the receiver.
    const camera = new THREE.OrthographicCamera(-0.06, 0.06, 0.015, -0.015, 0.1, 30);
    camera.up.set(0, 0, 1); camera.position.set(3, 3, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const output = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });
    const tracer = new WebGLPathTracer(renderer);
    tracer.renderToCanvas = false; tracer.renderDelay = 0; tracer.bounces = 2;
    tracer.stableNoise = true; tracer.tiles.set(1, 1); tracer.textureSize.set(32, 32);
    const measure = (target: import('three').WebGLRenderTarget) => {
      const pixels = new Float32Array(width * height * 4), profile = Array(width).fill(0);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) profile[x] += pixels[4 * (y * width + x)] / height;
      const peak = Math.max(...profile);
      return { width: profile.filter(v => v > peak * 0.1 && v < peak * 0.9).length, peak,
        finite: pixels.every(Number.isFinite) };
    };
    const raster = [], path = [];
    try {
      for (const gap of [0.25, 1]) {
        blocker.position.y = gap; scene.updateMatrixWorld(true);
        renderer.setRenderTarget(output); renderer.render(scene, camera); raster.push(measure(output));
        const physical = createPathTracingScene({ scene, sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 }, dispose() {} });
        physical.scene.environment = null; physical.scene.background = new THREE.Color(0);
        tracer.setScene(physical.scene, camera);
        while (tracer.samples < 64) {
          tracer.renderSample(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        path.push(measure(tracer.target)); physical.dispose();
      }
      return { raster, path };
    } finally {
      tracer.dispose(); output.dispose(); sun.shadow.map?.dispose();
      receiver.geometry.dispose(); receiver.material.dispose(); blocker.geometry.dispose(); blocker.material.dispose(); renderer.dispose();
    }
  });
  for (const method of [result.raster, result.path]) {
    expect(method.every(frame => frame.finite && frame.peak > 0.1)).toBe(true);
    expect(method[0].width).toBeGreaterThan(0);
    expect(method[1].width / method[0].width).toBeGreaterThan(1.8);
    expect(method[1].width / method[0].width).toBeLessThan(6);
  }
  expect(errors).toEqual([]);
});
