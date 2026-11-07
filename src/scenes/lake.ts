import type { RenderQuality } from '../domain/types';
import { RENDER_QUALITY } from '../data/renderQuality';
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/** Planar scene reflection, gently distorted by static capillary ripples. */
export function createLake() {
  const shader = {
    name: 'AlpineLakeReflection',
    uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vReflectionUv;
      varying vec3 vWorldPosition;
      void main() {
        vReflectionUv = textureMatrix * vec4(position, 1.0);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec3 color;
      varying vec4 vReflectionUv;
      varying vec3 vWorldPosition;
      void main() {
        vec4 uv = vReflectionUv;
        float wave = sin(vWorldPosition.x * 6.7 + vWorldPosition.z * 2.3)
          * sin(vWorldPosition.z * 12.1 + vWorldPosition.x * 0.9);
        uv.xy += vec2(wave * 0.00035, sin(vWorldPosition.z * 8.0) * 0.00016) * uv.w;
        vec3 reflection = texture2DProj(tDiffuse, uv).rgb;
        float grazing = 1.0 - clamp(normalize(cameraPosition - vWorldPosition).y, 0.0, 1.0);
        float fresnel = 0.22 + 0.78 * pow(grazing, 4.0);
        vec3 water = vec3(0.035, 0.115, 0.125);
        vec3 result = mix(water, reflection * mix(vec3(1.0), color, 0.12), fresnel);
        gl_FragColor = vec4(result, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
  const lake = new Reflector(new THREE.CircleGeometry(1, 160), {
    color: '#a9c5ca', textureWidth: 1024, textureHeight: 512, clipBias: 0.002, multisample: 0, shader,
  });
  lake.name = 'alpine-lake-reflection';
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(3, -0.8, -46);
  lake.scale.set(34, 38, 1);
  const target = lake.getRenderTarget();
  return { lake, target,
    setQuality(quality: RenderQuality) {
      const scale = RENDER_QUALITY[quality].resolutionScale;
      const width = Math.round(1024 * scale), height = Math.round(512 * scale);
      if (target.width !== width || target.height !== height) target.setSize(width, height);
    },
  };
}
