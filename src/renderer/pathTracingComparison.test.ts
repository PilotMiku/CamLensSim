import * as THREE from 'three';
import * as PathTracing from 'three-gpu-pathtracer';
import { describe, expect, it } from 'vitest';
import { SENSORS } from '../data/equipment';
import { matchedFramingFocalMm, workingFovDeg } from '../optics/calculate';
import { configurePhysicalCamera } from './pathTracing';

const { PhysicalPathTracingMaterial } = PathTracing as unknown as {
  PhysicalPathTracingMaterial: new () => THREE.ShaderMaterial & {
    physicalCamera: { bokehSize: number; updateFrom(camera: THREE.Camera): void };
  };
};

describe('format comparison in the physical path camera', () => {
  it('sends the actual entrance pupil to the tracer instead of the equivalent aperture', () => {
    const material = new PhysicalPathTracingMaterial(), physical = new PathTracing.PhysicalCamera();
    try {
      const pupils: number[] = [];
      for (const sensor of SENSORS) {
        const focalMm = matchedFramingFocalMm(85, 3, SENSORS[0], sensor);
        const source = new THREE.PerspectiveCamera(workingFovDeg(sensor.heightMm, focalMm, 3),
          sensor.widthMm / sensor.heightMm, 0.08, 80);
        configurePhysicalCamera(physical, source, { focalMm, aperture: 1.8, focusM: 3, blades: 9 }, true, sensor.heightMm);
        material.physicalCamera.updateFrom(physical);
        expect(material.physicalCamera.bokehSize).toBeCloseTo(focalMm / 1.8, 10);
        pupils.push(material.physicalCamera.bokehSize);
      }
      expect(pupils[1]).toBeLessThan(pupils[0]);
      expect(pupils[2]).toBeLessThan(pupils[1]);
      expect(pupils[3]).toBeGreaterThan(pupils[0]);
      configurePhysicalCamera(physical, new THREE.PerspectiveCamera(),
        { focalMm: 85, aperture: 1.8, focusM: 3, blades: 9 }, false, 24);
      material.physicalCamera.updateFrom(physical);
      expect(material.physicalCamera.bokehSize).toBe(0);
    } finally { material.dispose(); }
  });
});
