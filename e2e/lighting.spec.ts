import { expect, test } from '@playwright/test';

test('denoises 28-sample HDR noise while preserving a foreground silhouette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const filterModule = '/src/renderer/pathTracingDenoise.ts';
    const THREE = await import(threeModule);
    const { PathTracingDenoiser } = await import(filterModule);
    const renderer = new THREE.WebGLRenderer();
    const width = 64, height = 32, near = 0.1, far = 30;
    const truth = new Float32Array(width * height * 4), noisy = truth.slice(), depth = truth.slice();
    let seed = 28;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < width * height; i++) {
      const foreground = i % width < width / 2;
      const color = foreground ? [0.2, 0.3, 0.4] : [0.8, 0.6, 0.2];
      const distance = foreground ? 2 : 8;
      for (let c = 0; c < 3; c++) {
        truth[i * 4 + c] = color[c];
        noisy[i * 4 + c] = Math.max(0, color[c] + (random() - 0.5) * 0.44 + (i % 89 === 0 ? 2 : 0));
      }
      truth[i * 4 + 3] = noisy[i * 4 + 3] = 1;
      depth.fill(far * (distance - near) / (distance * (far - near)), i * 4, i * 4 + 4);
    }
    const texture = (pixels: Float32Array) => {
      const t = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
      t.needsUpdate = true; return t;
    };
    const noisyTexture = texture(noisy), guide = texture(truth), depthTexture = texture(depth);
    const source = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false });
    const output = source.clone();
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: noisyTexture } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: 'varying vec2 vUv; uniform sampler2D map; void main() { gl_FragColor = texture2D(map, vUv); }',
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad); renderer.setRenderTarget(source); renderer.render(scene, camera);
    const filter = new PathTracingDenoiser();
    const filtered = filter.render(renderer, source, depthTexture, guide, new THREE.PerspectiveCamera(40, 2, near, far), 28);
    material.uniforms.map.value = filtered;
    renderer.setRenderTarget(output); renderer.render(scene, camera);
    const pixels = new Float32Array(truth.length);
    renderer.readRenderTargetPixels(output, 0, 0, width, height, pixels);
    let before = 0, after = 0, edgeError = 0, edgeCount = 0;
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) {
      const offset = i * 4 + c;
      before += (noisy[offset] - truth[offset]) ** 2;
      after += (pixels[offset] - truth[offset]) ** 2;
      if (Math.abs(i % width - width / 2 + 0.5) < 2) {
        edgeError += Math.abs(pixels[offset] - truth[offset]); edgeCount++;
      }
    }
    filter.dispose(); source.dispose(); output.dispose();
    noisyTexture.dispose(); guide.dispose(); depthTexture.dispose();
    material.dispose(); quad.geometry.dispose(); renderer.dispose();
    return { noiseRatio: Math.sqrt(after / before), edgeError: edgeError / edgeCount, finite: pixels.every(Number.isFinite) };
  });
  expect(result.finite).toBe(true);
  expect(result.noiseRatio).toBeLessThan(0.4);
  expect(result.edgeError).toBeLessThan(0.04);
});

test('keeps fixed shadow-tested light shafts active in every scene', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('渲染质量').selectOption('low');
  for (const id of ['indoor', 'outdoor', 'portrait', 'animal']) {
    await page.getByLabel('选择场景').selectOption(id);
    await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-volumetric-light', 'true');
    await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-fixed-light-beam', 'true');
    await page.locator('canvas').screenshot({ path: `test-results/${test.info().project.name}-${id}-light-shafts.png` });
  }
  expect(errors).toEqual([]);
});
