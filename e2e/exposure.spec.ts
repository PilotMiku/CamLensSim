import { expect, test } from '@playwright/test';

test('keeps full exposure range in both output passes without re-exposing HDR or resetting path samples', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const results = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const simulatorModule = '/src/renderer/SimulatorRenderer.ts';
    const equipmentModule = '/src/data/equipment.ts';
    const THREE = await import(threeModule);
    const { SimulatorRenderer } = await import(simulatorModule);
    const { DEFAULT_PARAMETERS, SENSORS, getLens } = await import(equipmentModule);
    const results = [];
    for (const mode of ['realtime', 'pathtraced']) for (const band of ['bright', 'dark']) {
      const host = document.createElement('div');
      Object.assign(host.style, { width: '120px', height: '80px', position: 'fixed', top: '0', left: '0' });
      document.body.append(host);
      const radiance = band === 'bright' ? 1 / 512 : 16;
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(radiance, radiance, radiance) });
      const geometry = new THREE.PlaneGeometry(10, 10);
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = -3; scene.add(mesh);
      const sun = new THREE.DirectionalLight(0xffffff, 0);
      const sim = new SimulatorRenderer(host, { cameraNear: 0.08, cameraFar: 80,
        create: () => ({ scene, sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 },
          dispose: () => { material.dispose(); geometry.dispose(); } }),
      }, () => {});
      // Feed a known linear radiance to the production path-tracing output pass.
      // This isolates exposure from lighting, Monte Carlo variance and BVH construction.
      const texture = new THREE.DataTexture(new Float32Array([radiance, radiance, radiance, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      texture.needsUpdate = true;
      let updates = 0;
      if (mode === 'pathtraced') sim.pathPreview = { update() { updates++; },
        render() { return { samples: 128, texture }; }, dispose() {} };
      const view = { renderMode: mode, depthOfField: false, quality: 'smooth' };
      const aperture = band === 'bright' ? 1.8 : 32;
      const scales = band === 'bright' ? [8, 16, 32] : [0.001, 0.002, 0.004];
      const frames = [];
      const capture = (scale: number, constantExposure = false) => {
        sim.update({ ...DEFAULT_PARAMETERS, lensId: 'custom', aperture,
          shutterSeconds: scale * aperture * aperture / (1.8 * 1.8 * 125), constantExposure,
          pose: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 },
        }, SENSORS[0], getLens('custom'), view);
        sim.lastTraceUpdate = -1000;
        sim.renderFrame();
        const gl = sim.renderer.getContext();
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const hdr = new Uint16Array(4);
        sim.renderer.readRenderTargetPixels(sim.sceneTarget, Math.floor(sim.sceneTarget.width / 2), Math.floor(sim.sceneTarget.height / 2), 1, 1, hdr);
        return { scale, exposure: sim.renderer.toneMappingExposure, value: pixel[0], hdr: THREE.DataUtils.fromHalfFloat(hdr[0]) };
      };
      try {
        for (const scale of scales) frames.push(capture(scale));
        const fixedA = capture(scales[0], true).exposure;
        const fixedB = capture(scales[2], true).exposure;
        results.push({ mode, band, radiance, frames, updates, fixedA, fixedB });
      } finally { sim.dispose(); texture.dispose(); host.remove(); }
    }
    return results;
  });
  for (const result of results) {
    for (const frame of result.frames) {
      expect(frame.exposure / frame.scale).toBeCloseTo(0.85, 10);
      expect(frame.hdr).toBeCloseTo(result.radiance, 6);
    }
    expect(result.frames[1].value - result.frames[0].value).toBeGreaterThan(3);
    expect(result.frames[2].value - result.frames[1].value).toBeGreaterThan(3);
    expect(result.fixedA).toBe(0.85);
    expect(result.fixedB).toBe(0.85);
    if (result.mode === 'pathtraced') expect(result.updates).toBe(1);
  }
  await page.getByLabel('ISO', { exact: true }).selectOption('25600');
  await page.getByLabel('快门', { exact: true }).selectOption('30');
  await expect(page.getByLabel('ISO', { exact: true })).toHaveValue('25600');
  await expect(page.getByLabel('快门', { exact: true })).toHaveValue('30');
  expect(errors).toEqual([]);
});
