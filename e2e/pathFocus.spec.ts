import { expect, test } from '@playwright/test';

test('path camera rays converge on the axial focus plane across aperture, shift and near distance', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('canvas-host')).toHaveAttribute('data-status', 'ready');
  const result = await page.evaluate(async () => {
    const threeModule = '/node_modules/.vite/deps/three.js';
    const tracerModule = '/node_modules/.vite/deps/three-gpu-pathtracer.js';
    const focusModule = '/src/renderer/pathTracingFocus.ts';
    const THREE = await import(threeModule);
    const { PhysicalPathTracingMaterial } = await import(tracerModule);
    const { installPlanarFocus } = await import(focusModule);
    // Compile the production library's camera functions with deterministic aperture/AA
    // sampling. Read the actual GPU ray's intersection, not a second CPU camera model.
    const production = new PhysicalPathTracingMaterial();
    installPlanarFocus(production);
    const shader = { uniforms: {}, fragmentShader: production.fragmentShader };
    production.onBeforeCompile(shader, null);
    const functions = shader.fragmentShader.match(/vec3 ndcToRayOrigin\([\s\S]*?return ray;\s*\}/)?.[0];
    if (!functions) throw new Error('Missing camera functions');
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(16, 12);
    const target = new THREE.WebGLRenderTarget(16, 12, { type: THREE.FloatType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const camera = new THREE.PerspectiveCamera(70, 1.5, 0.08, 80);
    camera.position.set(1, 2, 3); camera.rotation.set(0.2, -0.4, 0);
    camera.updateMatrixWorld(true);
    const material = new THREE.ShaderMaterial({
      defines: { CAMERA_TYPE: 0, FEATURE_DOF: 1 },
      uniforms: {
        cameraWorldMatrix: { value: camera.matrixWorld }, invProjectionMatrix: { value: camera.projectionMatrixInverse },
        resolution: { value: new THREE.Vector2(16, 12) }, aperturePoint: { value: new THREE.Vector2() },
        physicalCamera: { value: { focusDistance: 3, bokehSize: 40, apertureRotation: 0, anamorphicRatio: 1, apertureBlades: 0 } },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform mat4 cameraWorldMatrix, invProjectionMatrix;
        uniform vec2 resolution, aperturePoint;
        struct Ray { vec3 origin; vec3 direction; };
        struct PhysicalCamera { float focusDistance; float bokehSize; float apertureRotation; float anamorphicRatio; int apertureBlades; };
        uniform PhysicalCamera physicalCamera;
        vec2 rand2(int i) { return vec2(0.5); }
        vec3 rand3(int i) { return vec3(0.5); }
        float tentFilter(float v) { return 0.0; }
        vec2 sampleAperture(int b, vec3 s) { return aperturePoint; }
        vec2 rotateVector(vec2 v, float r) { return v; }
        vec2 saturate(vec2 v) { return clamp(v, 0.0, 1.0); }
        ${functions}
        void main() {
          Ray ray = getCameraRay();
          vec3 forward = -normalize(cameraWorldMatrix[2].xyz), eye = cameraWorldMatrix[3].xyz;
          vec3 p = ray.origin + ray.direction * ((physicalCamera.focusDistance - dot(ray.origin - eye, forward)) / dot(ray.direction, forward));
          vec2 ndc = vUv * 2.0 - 1.0;
          vec3 pinhole = normalize(mat3(cameraWorldMatrix) * (invProjectionMatrix * vec4(ndc, 0.0, 1.0)).xyz);
          vec3 expected = eye + pinhole * (physicalCamera.focusDistance / dot(pinhole, forward));
          gl_FragColor = vec4(length(p - expected), dot(ray.origin - eye, forward), 0.0, 1.0);
        }`,
    });
    const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    const pixels = new Float32Array(16 * 12 * 4);
    let focusError = 0, nearError = 0;
    try {
      for (const near of [0.035, 0.08, 0.5]) for (const shift of [-0.5, 0, 0.5]) {
        camera.near = near; camera.setViewOffset(160, 120, shift * 160, shift * 120, 160, 120);
        camera.updateProjectionMatrix();
        for (const focus of [1, 3, 100]) for (const aperture of [[0, 0], [1, 0], [-0.7, 0.7]]) {
          material.uniforms.physicalCamera.value.focusDistance = focus;
          material.uniforms.aperturePoint.value.set(...aperture);
          renderer.setRenderTarget(target); renderer.render(scene, new THREE.Camera());
          renderer.readRenderTargetPixels(target, 0, 0, 16, 12, pixels);
          for (let i = 0; i < pixels.length; i += 4) {
            if (!Number.isFinite(pixels[i]) || !Number.isFinite(pixels[i + 1])) return { focusError: Infinity, nearError: Infinity };
            focusError = Math.max(focusError, pixels[i]);
            nearError = Math.max(nearError, Math.abs(pixels[i + 1] - near));
          }
        }
      }
      return { focusError, nearError };
    } finally { geometry.dispose(); material.dispose(); production.dispose(); target.dispose(); renderer.dispose(); }
  });
  expect(result.focusError).toBeLessThan(0.0002);
  expect(result.nearError).toBeLessThan(0.00001);
  expect(errors).toEqual([]);
});
