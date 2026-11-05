import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Spatial filtering only: never feed filtered pixels back into path accumulation. */
export class PathTracingDenoiser {
  private readonly targets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false,
  }));
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      tInput: { value: null }, tDepth: { value: null }, tGuide: { value: null },
      texel: { value: new THREE.Vector2() }, planes: { value: new THREE.Vector2() },
      stepSize: { value: 1 }, colorSigma: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tInput, tDepth, tGuide;
      uniform vec2 texel, planes;
      uniform float stepSize, colorSigma;
      float depthAt(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        return planes.x * planes.y / (planes.y - d * (planes.y - planes.x));
      }
      float denoiseLuminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 guideAt(vec2 uv) {
        vec3 c = texture2D(tGuide, uv).rgb;
        return c / (1.0 + denoiseLuminance(c));
      }
      void main() {
        vec3 center = texture2D(tInput, vUv).rgb;
        vec3 guide = guideAt(vUv);
        float depth = depthAt(vUv);
        // Follow sloped surfaces, choosing the derivative that does not cross a silhouette.
        vec2 forward = vec2(depthAt(vUv + vec2(texel.x, 0.0)), depthAt(vUv + vec2(0.0, texel.y))) - depth;
        vec2 backward = depth - vec2(depthAt(vUv - vec2(texel.x, 0.0)), depthAt(vUv - vec2(0.0, texel.y)));
        vec2 gradient = vec2(abs(forward.x) < abs(backward.x) ? forward.x : backward.x,
          abs(forward.y) < abs(backward.y) ? forward.y : backward.y);
        float mean = 0.0, secondMoment = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 uv = vUv + vec2(float(x), float(y)) * texel * stepSize;
          float value = denoiseLuminance(texture2D(tInput, uv).rgb);
          mean += value / 9.0; secondMoment += value * value / 9.0;
        }
        // Indirectly lit walls can alternate between dark and bright samples.
        // Estimate local noise rather than treating each dark sample as an edge.
        float deviation = sqrt(max(secondMoment - mean * mean, 0.0));
        float sigma = max(colorSigma * (0.12 + denoiseLuminance(center)), deviation * 1.8);
        vec3 sum = vec3(0.0); float weights = 0.0;
        for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
          vec2 offset = vec2(float(x), float(y)) * stepSize;
          vec2 uv = vUv + offset * texel;
          vec3 sampleColor = texture2D(tInput, uv).rgb;
          vec3 deltaGuide = guideAt(uv) - guide;
          float planeError = abs(depthAt(uv) - depth - dot(gradient, offset));
          float colorError = abs(denoiseLuminance(sampleColor) - denoiseLuminance(center));
          float weight = exp(-float(x * x + y * y) / 4.0
            - planeError / max(0.008, depth * 0.008)
            - dot(deltaGuide, deltaGuide) / 0.025
            - colorError / max(sigma, 0.001));
          sum += sampleColor * weight; weights += weight;
        }
        gl_FragColor = vec4(sum / max(weights, 0.00001), 1.0);
      }
    `,
  });
  private readonly quad = new FullScreenQuad(this.material);

  render(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget, depth: THREE.Texture,
    guide: THREE.Texture, camera: THREE.PerspectiveCamera, samples: number) {
    for (const target of this.targets) {
      if (target.width !== source.width || target.height !== source.height) target.setSize(source.width, source.height);
    }
    const u = this.material.uniforms;
    u.texel.value.set(1 / source.width, 1 / source.height);
    u.planes.value.set(camera.near, camera.far);
    u.tDepth.value = depth; u.tGuide.value = guide;
    // Gradually relax filtering as more independent paths resolve fine detail.
    u.colorSigma.value = Math.max(0.22, 2.8 / Math.sqrt(Math.max(1, samples)));
    let texture = source.texture;
    for (let pass = 0; pass < 3; pass++) {
      const target = this.targets[pass % 2];
      u.tInput.value = texture; u.stepSize.value = 1 << pass;
      renderer.setRenderTarget(target); this.quad.render(renderer);
      texture = target.texture;
    }
    renderer.setRenderTarget(null);
    return texture;
  }

  dispose() {
    this.targets.forEach(target => target.dispose());
    this.material.dispose(); this.quad.dispose();
  }
}
