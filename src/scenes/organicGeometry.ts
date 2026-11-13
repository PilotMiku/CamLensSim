import * as THREE from 'three';
import type { Point } from './modeling';

/** A closed elliptical loft with transported frames, shared by anatomy and hair.
 * Radii follow the same spline parameter as the centreline, including at joints. */
export function organicGeometry(points: Point[], radii: Array<[number, number]>, rows = 56, sides = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  const widths = new THREE.SplineCurve(radii.map(([x, z]) => new THREE.Vector2(x, z)));
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  let across = new THREE.Vector3(1, 0, 0);
  const previous = curve.getTangent(0).normalize();
  across.addScaledVector(previous, -across.dot(previous)).normalize();
  if (across.lengthSq() < 0.01) across.set(0, 0, 1).addScaledVector(previous, -previous.z).normalize();
  const rotation = new THREE.Quaternion();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, center = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
    rotation.setFromUnitVectors(previous, tangent);
    across.applyQuaternion(rotation).normalize(); previous.copy(tangent);
    const normal = new THREE.Vector3().crossVectors(across, tangent).normalize();
    const radius = widths.getPoint(t);
    for (let col = 0; col <= sides; col++) {
      const angle = col / sides * Math.PI * 2;
      const p = center.clone().addScaledVector(across, Math.cos(angle) * Math.max(0.00001, radius.x))
        .addScaledVector(normal, Math.sin(angle) * Math.max(0.00001, radius.y));
      positions.push(p.x, p.y, p.z); uv.push(col / sides, t);
      if (row < rows && col < sides) {
        const a = row * (sides + 1) + col;
        indices.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
      }
    }
  }
  // Separate centre vertices close the ends without a pinched first/last ring.
  for (const end of [0, 1]) {
    const p = curve.getPoint(end), center = positions.length / 3;
    positions.push(p.x, p.y, p.z); uv.push(0.5, end);
    const base = end * rows * (sides + 1);
    for (let col = 0; col < sides; col++) {
      if (end) indices.push(center, base + col + 1, base + col);
      else indices.push(center, base + col, base + col + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const normals = geometry.attributes.normal, seam = new THREE.Vector3(), other = new THREE.Vector3();
  for (let row = 0; row <= rows; row++) {
    const a = row * (sides + 1), b = a + sides;
    seam.fromBufferAttribute(normals, a).add(other.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, seam.x, seam.y, seam.z); normals.setXYZ(b, seam.x, seam.y, seam.z);
  }
  return geometry;
}
