import { expect, test } from './fixtures';

test('the independent path-traced sun lights RGB skin on both sides and casts an occluded shadow', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // A blank page avoids compiling the photographic set before this light transport check.
  await page.route('**/solar-light-check', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Solar light transport</title>',
  }));
  await page.goto('/solar-light-check');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const previewModule = '/src/renderer/pathTracing.ts';
    const THREE = await import(threeModule);
    const { PathTracingPreview } = await import(previewModule);
    const size = 32, renderer = new THREE.WebGLRenderer(); renderer.setSize(size, size);
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0); scene.environmentIntensity = 0;
    const sun = new THREE.DirectionalLight(0xffffff, 4);
    const direction = new THREE.Vector3(-0.4, 0.46, 0.79).normalize();
    sun.position.copy(direction).multiplyScalar(10); scene.add(sun, sun.target);
    // Mixing uncoloured geometry with RGB skin exposed the dropped-colour BVH regression.
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    plain.position.x = -10; scene.add(plain);
    const skinGeometry = new THREE.PlaneGeometry(2, 2), rgb = new Float32Array(12);
    for (let i = 0; i < 4; i++) rgb.set([0.8, 0.45, 0.3], i * 3);
    skinGeometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    const skin = new THREE.Mesh(skinGeometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, side: THREE.DoubleSide,
    })); scene.add(skin);
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshStandardMaterial({
      color: 0, transparent: true, opacity: 0, side: THREE.DoubleSide,
    }));
    blocker.name = 'solar-test-blocker'; blocker.position.copy(direction).multiplyScalar(0.6);
    blocker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); scene.add(blocker);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const guide = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
    guide.depthTexture = new THREE.DepthTexture(size, size);
    renderer.setRenderTarget(guide); renderer.render(scene, camera); renderer.setRenderTarget(null);
    const world = { scene, sunlight: { sun, density: 0, distance: 10, groundHeight: 0, heightFalloff: 0 }, dispose() {} };
    const preview = new PathTracingPreview(renderer, world, camera);
    const internals = preview as any;
    const output = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
    const material = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'uniform sampler2D map;varying vec2 vUv;void main(){gl_FragColor=texture2D(map,vUv);}',
    });
    const quadScene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quadScene.add(quad);
    const sample = async () => {
      preview.update(camera, { focalMm: 50, aperture: 4, focusM: 3, blades: 9 }, false, 24);
      let rendered;
      do {
        rendered = preview.render(guide.depthTexture!, guide.texture);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      } while (rendered.samples < 24);
      // Measure transported radiance before spatial denoising can blur a small shadow.
      material.uniforms.map.value = internals.tracer.target.texture;
      renderer.setRenderTarget(output); renderer.render(quadScene, new THREE.Camera());
      const pixels = new Float32Array(4 * 4 * 4);
      renderer.readRenderTargetPixels(output, 14, 14, 4, 4, pixels);
      renderer.setRenderTarget(null);
      const rgb = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += pixels[i + c] / 16;
      return rgb;
    };
    try {
      const on = await sample();
      sun.intensity = 0; const off = await sample();
      sun.intensity = 4;
      const tracedBlocker = internals.physicalWorld.scene.getObjectByName(blocker.name);
      tracedBlocker.material.opacity = 1; internals.tracer.updateMaterials();
      const occluded = await sample();
      tracedBlocker.material.castShadow = false; internals.tracer.updateMaterials();
      const unshadowed = await sample();
      tracedBlocker.material.opacity = 0; internals.tracer.updateMaterials();
      camera.position.z = -3; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      sun.position.z *= -1;
      const back = await sample();
      return { on, off, occluded, unshadowed, back };
    } finally {
      preview.dispose(); guide.dispose(); output.dispose();
      for (const mesh of [plain, skin, blocker, quad]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      renderer.dispose();
    }
  });
  await test.info().attach('solar-radiance', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
  for (const rgb of [result.on, result.back]) {
    expect(rgb.every(Number.isFinite)).toBe(true);
    expect(rgb[0], 'skin must reflect the explicit sun with the environment disabled').toBeGreaterThan(0.2);
    expect(rgb[0] / rgb[1], 'sunlit skin must retain its vertex-colour proportions').toBeCloseTo(0.8 / 0.45, 1);
  }
  expect(result.back[0] / result.on[0]).toBeGreaterThan(0.65);
  expect(result.back[0] / result.on[0]).toBeLessThan(1.35);
  expect(result.off[0], 'turning off the authoritative sun must remove its light').toBeLessThan(0.001);
  expect(result.occluded[0], 'a blocker must cast an actual ray-traced solar shadow').toBeLessThan(result.on[0] * 0.1);
  expect(result.unshadowed[0], 'non-shadow-casting glazing must let sunlight through').toBeGreaterThan(result.on[0] * 0.65);
});
