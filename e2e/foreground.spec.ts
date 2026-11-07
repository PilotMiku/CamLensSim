import { expect, test } from '@playwright/test';

test('near bokeh spreads over sharp background, reconstructs the inside edge and respects depth order', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const shaderModule = '/src/renderer/depthOfField.ts';
    const sampleModule = '/src/renderer/dofSampling.ts';
    const THREE = await import(threeModule);
    const { nearRadiusShader, foregroundShader, bokehShader, compositeShader } = await import(shaderModule);
    const { createDofDiskSamples } = await import(sampleModule);
    const renderer = new THREE.WebGLRenderer();
    const w = 64, h = 32, near = 0.08, far = 80;
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const geometry = new THREE.PlaneGeometry(2, 2), quad = new THREE.Mesh(geometry);
    scene.add(quad);
    const textures: import('three').DataTexture[] = [], materials: import('three').ShaderMaterial[] = [];
    const texture = (width: number, height: number, pixel: (x: number) => number[]) => {
      const data = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x), 4 * (y * width + x));
      const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
      t.needsUpdate = true; textures.push(t); return t;
    };
    const color = texture(w, h, x => x < w / 2 ? [1, 0, 0, 1] : [0, 0, 1, 1]);
    const fullColor = texture(w * 2, h * 2, x => x < w ? [1, 0, 0, 1] : [0, 0, 1, 1]);
    const coc = texture(w, h, x => x < w / 2 ? [-16, 1, 0, 1] : [0, 3, 0, 1]);
    const encodedDepth = (z: number) => far * (z - near) / (z * (far - near));
    const depth = texture(w * 2, h * 2, x => [encodedDepth(x < w ? 1 : 3), 0, 0, 1]);
    const targets = Array.from({ length: 5 }, (_, i) => new THREE.WebGLRenderTarget(i === 4 ? w * 2 : w,
      i === 4 ? h * 2 : h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    const [horizontal, radius, foreground, background, output] = targets;
    const draw = (shader: { vertexShader: string; fragmentShader: string }, values: Record<string, unknown>, target: import('three').WebGLRenderTarget) => {
      const uniforms = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
      const material = new THREE.ShaderMaterial({ ...shader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
      materials.push(material); quad.material = material;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
    };
    const read = (target: import('three').WebGLRenderTarget, x: number) => {
      const p = new Float32Array(4);
      renderer.readRenderTargetPixels(target, x, Math.floor(target.height / 2), 1, 1, p);
      return Array.from(p);
    };
    const results = [];
    try {
      draw(nearRadiusShader, { tInput: coc, direction: new THREE.Vector2(1 / w, 0), radiusLimit: 8, fromCoc: true }, horizontal);
      draw(nearRadiusShader, { tInput: horizontal.texture, direction: new THREE.Vector2(0, 1 / h), radiusLimit: 8, fromCoc: false }, radius);
      for (const sampleCount of [14, 44]) for (const blades of [0, 7]) {
        const common = { tHalfColor: color, tCoc: coc, halfTexel: new THREE.Vector2(1 / w, 1 / h),
          maxRadius: 16, sampleCount, blades, annular: 0,
          diskSamples: createDofDiskSamples(sampleCount).map((p: { x: number; y: number }) => new THREE.Vector2(p.x, p.y)) };
        draw(foregroundShader, { ...common, tNearRadius: radius.texture }, foreground);
        draw(bokehShader, common, background);
        draw(compositeShader, { tColor: fullColor, tBlur: background.texture, tForeground: foreground.texture,
          tCoc: coc, halfSize: new THREE.Vector2(w, h), tDepth: depth, resolution: new THREE.Vector2(w * 2, h * 2),
          nearPlane: near, farPlane: far, focalMm: 135, aperture: 1.8, inverseFocusM: 1 / 3,
          imageDistanceMm: 135 * 3000 / 2865, focusGradientPerM: 0, shiftY: 0, vFovRad: Math.PI / 6,
          sensorWidthMm: 36, fullWidthPx: w * 2, diffractionMm: 0, dofEnabled: true,
          vignetteAmount: 0, grainAmount: 0, grainSeed: 0, sunlightEnabled: false,
        }, output);
        results.push({ sampleCount, blades, outside: read(output, w + 4), inside: read(output, w - 4), far: read(output, w + 20) });
      }
      // An equally defocused source behind the receiver must not cover it (e.g. a tilted focal plane).
      const data = coc.image.data as Float32Array;
      for (let i = 0; i < w * h; i++) data[i * 4 + 1] = i % w < w / 2 ? 2 : 0.5;
      coc.needsUpdate = true;
      const finalCommon = { tHalfColor: color, tCoc: coc, tNearRadius: radius.texture,
        halfTexel: new THREE.Vector2(1 / w, 1 / h), maxRadius: 16, sampleCount: 44, blades: 0, annular: 0,
        diskSamples: createDofDiskSamples(44).map((p: { x: number; y: number }) => new THREE.Vector2(p.x, p.y)),
      };
      draw(foregroundShader, finalCommon, foreground);
      const occluded = read(foreground, w / 2 + 2);
      // Reverse focus: a sharp close silhouette must retain its exact full-resolution color.
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = i % w < w / 2 ? 0 : 16;
        data[i * 4 + 1] = i % w < w / 2 ? 1 : 3;
      }
      coc.needsUpdate = true;
      draw(foregroundShader, finalCommon, foreground);
      draw(bokehShader, finalCommon, background);
      draw(compositeShader, { tColor: fullColor, tBlur: background.texture, tForeground: foreground.texture,
        tCoc: coc, halfSize: new THREE.Vector2(w, h), tDepth: depth, resolution: new THREE.Vector2(w * 2, h * 2),
        nearPlane: near, farPlane: far, focalMm: 135, aperture: 1.8, inverseFocusM: 1,
        imageDistanceMm: 135 * 1000 / 865, focusGradientPerM: 0, shiftY: 0, vFovRad: Math.PI / 6,
        sensorWidthMm: 36, fullWidthPx: w * 2, diffractionMm: 0, dofEnabled: true,
        vignetteAmount: 0, grainAmount: 0, grainSeed: 0, sunlightEnabled: false,
      }, output);
      return { results, occluded, sharp: read(output, w - 2) };
    } finally {
      targets.forEach(t => t.dispose()); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
      geometry.dispose(); renderer.dispose();
    }
  });
  for (const frame of result.results) {
    expect(frame.outside[0], JSON.stringify(frame)).toBeGreaterThan(0.05);
    expect(frame.outside[2]).toBeGreaterThan(0.1);
    expect(frame.inside[2]).toBeGreaterThan(0.05);
    expect(frame.inside[0]).toBeGreaterThan(0.1);
    expect(frame.far[0]).toBeCloseTo(0, 5);
    expect(frame.far[2]).toBeCloseTo(1, 5);
    expect([...frame.outside, ...frame.inside, ...frame.far].every(Number.isFinite)).toBe(true);
  }
  expect(result.occluded[3]).toBe(0);
  expect(result.sharp[0]).toBeCloseTo(1, 5);
  expect(result.sharp[2]).toBeCloseTo(0, 5);
  expect(errors).toEqual([]);
});
