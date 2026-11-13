import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { organicGeometry } from './organicGeometry';
import { createSurface, fbm2D } from './textures';
import type { Point } from './modeling';

/** Layered, side-parted hair with solid locks and fine directional fibre detail. */
export function addPortraitHair(head: THREE.Group, headGeometry: THREE.BufferGeometry) {
  const surface = createSurface({ size: 512, normalStrength: 0.65,
    height: (u, v) => 0.5 + Math.sin(u * Math.PI * 2 * 90 + Math.sin(v * 12) * 0.8) * 0.19
      + fbm2D(u, v, 180, 12, 23, 2) * 0.16,
    color: (u, v, h) => {
      const tone = 0.64 + h * 0.25 + fbm2D(u, v, 48, 4, 73, 2) * 0.11;
      return [tone, tone * 0.87, tone * 0.75];
    },
    roughness: (_u, _v, h) => 0.86 + h * 0.10,
  });
  const material = new THREE.MeshPhysicalMaterial({ ...surface, color: '#302621', roughness: 0.72,
    normalScale: new THREE.Vector2(0.12, 0.12), metalness: 0, anisotropy: 0.18, specularIntensity: 0.45,
    anisotropyRotation: Math.PI / 2, sheen: 0.18, sheenColor: new THREE.Color('#897163'), sheenRoughness: 0.8 });
  const cap = headGeometry.clone(), p = cap.attributes.position, n = cap.attributes.normal;
  cap.deleteAttribute('color');
  const indices: number[] = [];
  for (let i = 0; i < cap.index!.count; i += 3) {
    const ids = [cap.index!.getX(i), cap.index!.getX(i + 1), cap.index!.getX(i + 2)];
    if (ids.every(id => p.getY(id) > -0.052 + 0.138 * THREE.MathUtils.clamp(p.getZ(id) / 0.075, 0, 1))) indices.push(...ids);
  }
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.0025,
    p.getY(i) + n.getY(i) * 0.0025, p.getZ(i) + n.getZ(i) * 0.0025);
  cap.setIndex(indices); cap.computeVertexNormals();
  const scalp = new THREE.Mesh(cap, material); scalp.name = 'natural-hairline-cap';
  scalp.castShadow = scalp.receiveShadow = true; head.add(scalp);

  const locks: THREE.BufferGeometry[] = [];
  const lock = (points: Point[], width: number, thickness: number, rows = 48) => {
    const radii = points.map((_, i): [number, number] => {
      const t = i / (points.length - 1);
      const taper = i === points.length - 1 ? 0.025 : i === 0 ? 0.04 : 0.8 + Math.sin(t * Math.PI) * 0.20;
      return [width * taper, thickness * taper];
    });
    locks.push(organicGeometry(points, radii, rows, 10));
  };
  // Overlapping locks wrap around the skull, then settle onto shoulders and back.
  // Their ends vary in length and curl rather than sharing a straight sheet edge.
  for (let i = 0; i < 42; i++) {
    const t = i / 41, a = -0.10 + t * (Math.PI + 0.20);
    const c = Math.cos(a), s = Math.sin(a), edge = Math.abs(c) ** 6;
    const length = 0.45 + 0.065 * Math.sin(i * 2.37) + 0.04 * (1 - edge);
    const sway = Math.sin(i * 1.71) * 0.007;
    lock([
      [c * 0.041, 0.109 - s * 0.009, -0.009 - s * 0.039],
      [c * 0.076, 0.064, -0.012 - s * 0.071],
      [c * 0.087, -0.017, -0.012 - s * 0.080],
      [c * (0.102 + edge * 0.012), -0.121, -0.020 - s * 0.091 + edge * 0.048],
      [c * 0.136 + sway, -0.245, -0.040 - s * 0.063 + edge * 0.065],
      [c * 0.128 - sway, -length * 0.78, -0.037 - s * 0.056 + edge * 0.068],
      [c * 0.116 + sway, -length, -0.028 - s * 0.059 + edge * 0.066],
    ], 0.012 + (i % 4) * 0.0014, 0.0038);
  }
  // Soft face-framing layers keep the cheeks and the eye focus target clear.
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const offset = i * 0.004, end = 0.24 + i * 0.034;
    lock([
      [side * (0.059 + offset * 0.4), 0.087, 0.025],
      [side * (0.079 + offset * 0.3), 0.038, 0.048],
      [side * (0.081 + offset * 0.6), -0.024, 0.049],
      [side * (0.091 + offset), -0.102, 0.062],
      [side * (0.118 + offset), -end * 0.74, 0.093],
      [side * (0.108 + offset), -end, 0.104],
    ], 0.0065, 0.0035, 40);
  }
  // Fine overlapping swept fringe from an off-centre part. Roots sit on the crown.
  for (const side of [-1, 1]) for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const rootX = -0.018 + side * t * 0.006;
    const endX = side * (0.022 + t * 0.060);
    lock([
      [rootX, 0.112 - t * 0.004, 0.006 + t * 0.020],
      [rootX + side * 0.019, 0.096 - t * 0.005, 0.049 + t * 0.009],
      [endX * 0.75, 0.073 - t * 0.006, 0.073 - t * 0.011],
      [endX, 0.053 - t * 0.018, 0.077 - t * 0.035],
    ], 0.0064, 0.0028, 32);
  }
  const geometry = mergeGeometries(locks)!; locks.forEach(g => g.dispose());
  const hair = new THREE.Mesh(geometry, material); hair.name = 'layered-swept-hair';
  hair.castShadow = hair.receiveShadow = true; head.add(hair);

  // A few fine flyaways soften the silhouette; closed tubes also survive BVH baking.
  const fibres: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) for (let i = 0; i < 12; i++) {
    const t = i / 11, x = side * (0.078 + t * 0.012);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0.058 - t * 0.03, 0.021),
      new THREE.Vector3(x + side * 0.009, -0.003 - t * 0.05, 0.044),
      new THREE.Vector3(x + side * 0.012, -0.076 - t * 0.08, 0.054),
      new THREE.Vector3(x + side * 0.005, -0.115 - t * 0.08, 0.063),
    ]);
    fibres.push(new THREE.TubeGeometry(curve, 24, 0.00016, 4, false));
  }
  const flyaways = new THREE.Mesh(mergeGeometries(fibres)!, material);
  fibres.forEach(g => g.dispose()); flyaways.name = 'fine-temple-flyaways'; head.add(flyaways);
}
