import { expect, test } from '@playwright/test';

test('sensor noise follows exposure statistics and has a stable capture seed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const results = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const shaderModule = '/src/renderer/sensorNoiseShader.ts';
    const modelModule = '/src/optics/sensorNoise.ts';
    const THREE = await import(threeModule);
    const { sensorNoiseShader } = await import(shaderModule);
    const { sensorNoiseCoefficients, sensorNoiseVariance } = await import(modelModule);
    const renderer = new THREE.WebGLRenderer();
    const w = 256, h = 128;
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const uniforms = { noiseResolution: { value: new THREE.Vector2(w, h) }, noiseSeed: { value: 17 },
      shotVariance: { value: 0 }, readVariance: { value: 0 }, outputGain: { value: 1 } };
    const material = new THREE.ShaderMaterial({ uniforms, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position.xy, 0., 1.); }',
      fragmentShader: `varying vec2 vUv; uniform float outputGain; ${sensorNoiseShader}
        void main() { gl_FragColor=vec4(applySensorNoise(vec3(0.18), vUv) * outputGain, 1.0); }`,
    });
    const geometry = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene(), camera = new THREE.Camera();
    scene.add(new THREE.Mesh(geometry, material));
    const draw = (iso: number, t: number, seed = 17) => {
      const c = sensorNoiseCoefficients({ iso, aperture: 1.8, shutterSeconds: t }, { widthMm: 36, heightMm: 24 });
      const gain = c.lightScale * c.isoGain;
      uniforms.shotVariance.value = c.shotVariance; uniforms.readVariance.value = c.readVariance;
      uniforms.noiseSeed.value = seed; uniforms.outputGain.value = gain;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Float32Array(w * h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
      let mean = 0, second = 0;
      for (let i = 0; i < w * h; i++) { mean += pixels[4 * i] / (w * h); second += pixels[4 * i] ** 2 / (w * h); }
      return { pixels, mean, variance: second - mean * mean, expected: sensorNoiseVariance(0.18, c) * gain * gain };
    };
    try {
      const base = draw(100, 1 / 125), repeated = draw(100, 1 / 125), changed = draw(100, 1 / 125, 18);
      const amplified = draw(6400, 1 / 125);
      const matched = [6400, 12800, 25600].map(iso => draw(iso, 100 / (iso * 125)));
      let stable = true, changedPixels = 0;
      for (let i = 0; i < base.pixels.length; i += 4) {
        stable &&= base.pixels[i] === repeated.pixels[i];
        if (base.pixels[i] !== changed.pixels[i]) changedPixels++;
      }
      const stats = ({ mean, variance, expected }: typeof base) => ({ mean, variance, expected });
      return { stable, changedPixels, base: stats(base), amplified: stats(amplified), matched: matched.map(stats) };
    } finally { target.dispose(); material.dispose(); geometry.dispose(); renderer.dispose(); }
  });
  expect(results.stable).toBe(true);
  expect(results.changedPixels).toBeGreaterThan(30000);
  for (const stats of [results.base, results.amplified, ...results.matched]) {
    expect(Number.isFinite(stats.variance)).toBe(true);
    expect(Math.abs(stats.variance / stats.expected - 1)).toBeLessThan(0.1);
  }
  expect(results.amplified.mean / results.base.mean).toBeCloseTo(64, 2);
  expect(results.amplified.variance / results.base.variance).toBeCloseTo(4096, 0);
  expect(results.matched[1].variance).toBeGreaterThan(results.matched[0].variance);
  expect(results.matched[2].variance).toBeGreaterThan(results.matched[1].variance);
  expect(errors).toEqual([]);
});
