import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bakeEnvironmentFill } from './pathTracingEnvironment';

function environment() {
  return new THREE.DataTexture(new Float32Array(8 * 4 * 4).fill(0.2), 8, 4, THREE.RGBAFormat, THREE.FloatType);
}

describe('physical environment fill', () => {
  it('preserves irradiance across HDR intensity settings and owns its pixels', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 0.9));
    const original = environment();
    for (const intensity of [0.3, 1, 2]) {
      scene.environmentIntensity = intensity;
      const copy = original.clone();
      expect(bakeEnvironmentFill(scene, copy)).toBe(true);
      expect(copy.image.data).not.toBe(original.image.data);
      // Integrating constant radiance over a cosine-weighted hemisphere gives PI * L.
      expect((copy.image.data[0] - original.image.data[0]) * intensity * Math.PI).toBeCloseTo(0.9);
      expect(original.image.data[0]).toBeCloseTo(0.2);
      copy.dispose();
    }
    original.dispose();
  });

  it('keeps the sky/ground gradient, ignores hidden fill and supports zero HDR intensity', () => {
    const scene = new THREE.Scene(); scene.environmentIntensity = 0;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1));
    const hidden = new THREE.AmbientLight(0xffffff, 100); hidden.visible = false; scene.add(hidden);
    const texture = environment(); bakeEnvironmentFill(scene, texture);
    expect(texture.image.data[3 * 8 * 4]).toBeGreaterThan(texture.image.data[0]);
    expect(texture.image.data[3 * 8 * 4]).toBeLessThan(1 / Math.PI);
    texture.dispose();
  });

  it('leaves an environment unchanged when there are no raster fill lights', () => {
    const texture = environment(), source = texture.source;
    expect(bakeEnvironmentFill(new THREE.Scene(), texture)).toBe(false);
    expect(texture.source).toBe(source);
    texture.dispose();
  });
});
