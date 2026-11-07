import { expect, test } from '@playwright/test';

test('path denoising preserves HDR without the float-linear extension', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' || m.text().includes('Unable to use linear filtering')) errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const denoiseModule = '/src/renderer/pathTracingDenoise.ts';
    const THREE = await import(threeModule);
    const { PathTracingDenoiser } = await import(denoiseModule);
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2')!;
    const getExtension = gl.getExtension.bind(gl);
    // Three.js enables extensions during construction, so hide it first.
    gl.getExtension = (name: string) => name === 'OES_texture_float_linear' ? null : getExtension(name);
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    const hasFloatLinear = renderer.extensions.has('OES_texture_float_linear');
    const source = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const guide = new THREE.DataTexture(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const depth = new THREE.DataTexture(new Float32Array([0.95, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    guide.needsUpdate = depth.needsUpdate = true;
    const denoiser = new PathTracingDenoiser();
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.08, 80);
    const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(100000.0, 50000.0, 1.0, 1.0); }' });
    scene.add(new THREE.Mesh(geometry, material));
    try {
      renderer.setRenderTarget(source);
      renderer.render(scene, new THREE.Camera());
      const texture = denoiser.render(renderer, source, depth, guide, camera, 1);
      const output = denoiser.targets.find((t: import('three').WebGLRenderTarget) => t.texture === texture);
      const pixels = new Float32Array(8 * 8 * 4);
      renderer.readRenderTargetPixels(output, 0, 0, 8, 8, pixels);
      return { hasFloatLinear, finite: pixels.every(Number.isFinite),
        maxRelativeError: Math.max(...Array.from(pixels, (value, i) => Math.abs(value / [100000, 50000, 1, 1][i % 4] - 1))) };
    } finally {
      denoiser.dispose(); source.dispose(); guide.dispose(); depth.dispose();
      geometry.dispose(); material.dispose(); renderer.dispose();
    }
  });
  expect(result.hasFloatLinear).toBe(false);
  expect(result.finite).toBe(true);
  expect(result.maxRelativeError).toBeLessThan(0.00001);
  expect(errors).toEqual([]);
});
