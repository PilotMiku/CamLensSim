import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { organicGeometry } from './organicGeometry';

describe('continuous organic lofts', () => {
  it('keeps outward normals and closes both ends of a straight limb', () => {
    const geometry = organicGeometry([[0, 0, 0], [0, 0.5, 0], [0, 1, 0]], [[0.1, 0.08], [0.09, 0.07], [0.04, 0.04]], 24, 16);
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    for (let row = 1; row < 24; row++) for (let col = 0; col <= 16; col++) {
      const i = row * 17 + col;
      expect(p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(0);
    }
    const start = 25 * 17, end = start + 1;
    expect(n.getY(start)).toBeCloseTo(-1);
    expect(n.getY(end)).toBeCloseTo(1);
    geometry.dispose();
  });

  it('transports finite frames through a bent elbow and along the initial reference axis', () => {
    for (const points of [
      [[0, 0, 0], [0.2, -0.2, 0], [0.1, 0.1, 0.1]],
      [[0, 0, 0], [0.2, 0, 0], [0.4, 0.1, 0.05]],
    ] as [number, number, number][][]) {
      const geometry = organicGeometry(points, [[0.04, 0.035], [0.025, 0.028], [0.016, 0.018]]);
      for (const name of ['position', 'normal', 'uv']) {
        expect(Array.from(geometry.attributes[name].array).every(Number.isFinite)).toBe(true);
      }
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.isEmpty()).toBe(false);
      const normals = geometry.attributes.normal;
      for (let row = 0; row <= 56; row++) {
        const first = new THREE.Vector3().fromBufferAttribute(normals, row * 25);
        const last = new THREE.Vector3().fromBufferAttribute(normals, row * 25 + 24);
        expect(first.distanceTo(last)).toBeLessThan(1e-6);
      }
      geometry.dispose();
    }
  });
});
