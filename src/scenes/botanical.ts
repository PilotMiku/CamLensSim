import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from './helpers';
import { leafGeometry, type Point } from './modeling';
import { createSurface, fbm2D } from './textures';

/** Closed, tapered branch; the same curve drives offshoot placement. */
export function branchGeometry(points: Point[], radius: number, tip = radius * 0.18, segments = 32) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geometry = new THREE.TubeGeometry(curve, segments, radius, 10, false);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const t = geometry.attributes.uv.getX(i);
    const center = curve.getPointAt(t);
    const ratio = THREE.MathUtils.lerp(1, tip / radius, t);
    positions.setXYZ(i, center.x + (positions.getX(i) - center.x) * ratio,
      center.y + (positions.getY(i) - center.y) * ratio, center.z + (positions.getZ(i) - center.z) * ratio);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function barkMaterial(seed = 52) {
  const surface = createSurface({ size: 512, repeat: [2, 3], normalStrength: 2.8,
    height: (u, v) => fbm2D(u, v, 32, 4, seed) * 0.65
      + fbm2D(u, v, 90, 12, seed + 1) * 0.16 + Math.sin(u * 115 + Math.sin(v * 18)) * 0.12,
    color: (u, v, h) => {
      const patch = fbm2D(u, v, 9, 18, seed + 5);
      if (patch > 0.64) return [0.47 + h * 0.18, 0.49 + h * 0.18, 0.32 + h * 0.14];
      return [0.20 + h * 0.20, 0.17 + h * 0.18, 0.12 + h * 0.16];
    }, roughness: (_u, _v, h) => 0.76 + h * 0.2,
  });
  return new THREE.MeshStandardMaterial({ ...surface, roughness: 0.92, normalScale: new THREE.Vector2(0.6, 0.6) });
}

export function foliageMaterial() {
  const surface = createSurface({ size: 256, normalStrength: 1.5,
    height: (u, v) => {
      const midrib = Math.exp(-(((u - 0.5) * 85) ** 2));
      const veins = Math.pow(Math.max(0, Math.cos((v * 14 + Math.abs(u - 0.5) * 10) * Math.PI * 2)), 14);
      return 0.3 + midrib * 0.35 + veins * 0.10 + fbm2D(u, v, 25, 25, 33) * 0.12;
    }, color: (u, _v, h) => {
      const edge = Math.abs(u - 0.5) * 0.15;
      return [0.38 + h * 0.14 - edge, 0.51 + h * 0.22, 0.22 + h * 0.10];
    }, roughness: () => 0.66,
  });
  return new THREE.MeshPhysicalMaterial({ ...surface, color: '#e7e8c3', roughness: 0.65,
    sheen: 0.35, sheenColor: new THREE.Color('#b8d96d'), sheenRoughness: 0.8,
    side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.25, 0.25) });
}

/** Five softly cupped petals, with blush concentrated around the stamens. */
export function blossomGeometry(petalCount = 5) {
  const geometries: THREE.BufferGeometry[] = [];
  for (let petal = 0; petal < petalCount; petal++) {
    const geometry = new THREE.SphereGeometry(1, 8, 4);
    const positions = geometry.attributes.position;
    const colors: number[] = [];
    const angle = petal / petalCount * Math.PI * 2;
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) * 0.46;
      const y = positions.getY(i) * 0.62 + 0.52;
      const z = positions.getZ(i) * 0.045 + y * y * 0.14;
      positions.setXYZ(i, x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z);
      color.set('#fff8f5').lerp(new THREE.Color('#ea7a93'), Math.max(0, 1 - y) * 0.62);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometries.push(geometry);
  }
  const center = new THREE.SphereGeometry(0.14, 6, 4);
  const centerColors: number[] = [];
  const color = new THREE.Color('#e5bd62');
  for (let i = 0; i < center.attributes.position.count; i++) centerColors.push(color.r, color.g, color.b);
  center.setAttribute('color', new THREE.Float32BufferAttribute(centerColors, 3));
  center.translate(0, 0, 0.08);
  geometries.push(center);
  const merged = mergeGeometries(geometries, false)!;
  geometries.forEach((g) => g.dispose());
  return merged;
}

/** Sakura boughs spread over the path. Petals and leaves remain actual 3D surfaces. */
export function cherryTree(seed: number, height: number, bark: THREE.Material) {
  const group = new THREE.Group();
  const rand = seededRandom(seed);
  const branchGeometries: THREE.BufferGeometry[] = [];
  const blossoms: THREE.Vector3[] = [];
  branchGeometries.push(branchGeometry([[0, 0, 0], [0.12, height * 0.4, 0], [-0.08, height * 0.72, 0.08], [0, height, 0]], 0.12, 0.025));
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.4;
    const root = new THREE.Vector3(0, height * (0.47 + rand() * 0.37), 0);
    const end = root.clone().add(new THREE.Vector3(Math.cos(angle) * height * (0.25 + rand() * 0.3), height * (0.1 + rand() * 0.17), Math.sin(angle) * height * 0.45));
    const middle = root.clone().lerp(end, 0.6).add(new THREE.Vector3(0, 0.12, 0));
    branchGeometries.push(branchGeometry([root.toArray(), middle.toArray(), end.toArray()], 0.035, 0.004, 20));
    for (let j = 0; j < 4; j++) {
      const start = middle.clone().lerp(end, rand());
      const tip = start.clone().add(new THREE.Vector3((rand() - 0.5) * 0.8, 0.1 + rand() * 0.4, (rand() - 0.5) * 0.7));
      branchGeometries.push(branchGeometry([start.toArray(), tip.toArray()], 0.006, 0.001, 8));
      for (let k = 0; k < 18; k++) blossoms.push(start.clone().lerp(tip, rand()).add(new THREE.Vector3((rand() - 0.5) * 0.14, (rand() - 0.5) * 0.14, (rand() - 0.5) * 0.14)));
    }
  }
  const wood = mergeGeometries(branchGeometries, false)!;
  branchGeometries.forEach((g) => g.dispose());
  const trunk = new THREE.Mesh(wood, bark);
  trunk.castShadow = trunk.receiveShadow = true;
  group.add(trunk);
  const material = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true,
    roughness: 0.62, sheen: 0.45, sheenColor: new THREE.Color('#ffc8d5'), side: THREE.DoubleSide });
  const flowers = new THREE.InstancedMesh(blossomGeometry(), material, blossoms.length);
  const transform = new THREE.Object3D();
  for (let i = 0; i < blossoms.length; i++) {
    transform.position.copy(blossoms[i]);
    transform.rotation.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    transform.scale.setScalar(0.024 + rand() * 0.018);
    transform.updateMatrix();
    flowers.setMatrixAt(i, transform.matrix);
  }
  flowers.castShadow = flowers.receiveShadow = true;
  group.add(flowers);
  return group;
}

/** Near-field leaves and flowers on a branch, with repeatable placement. */
export function leafSpray(points: Point[], seed: number, material: THREE.Material, count = 60, size = 0.12) {
  const rand = seededRandom(seed);
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const leaves = new THREE.InstancedMesh(leafGeometry(), material, count);
  const transform = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    transform.position.copy(curve.getPointAt(rand())).add(new THREE.Vector3((rand() - 0.5) * size, 0, (rand() - 0.5) * size));
    transform.rotation.set(rand() * 1.4, rand() * 6.28, (i % 2 ? -1 : 1) * (0.5 + rand()));
    transform.scale.setScalar(size * (0.65 + rand() * 0.7));
    transform.updateMatrix();
    leaves.setMatrixAt(i, transform.matrix);
  }
  leaves.castShadow = leaves.receiveShadow = true;
  return leaves;
}

/** Batched meadow blades, with open ground along the winding footpath. */
export function meadow(height: (x: number, z: number) => number, seed: number, bounds: [number, number, number, number], count = 9000) {
  const rand = seededRandom(seed);
  const blade = new THREE.PlaneGeometry(1, 1, 1, 3);
  const positions = blade.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const t = positions.getY(i) + 0.5;
    positions.setXYZ(i, positions.getX(i) * (1 - t * 0.96), t, t * t * 0.22);
  }
  blade.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  const blades = new THREE.InstancedMesh(blade, material, count);
  const transform = new THREE.Object3D(), color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = THREE.MathUtils.lerp(bounds[0], bounds[1], rand());
    const z = THREE.MathUtils.lerp(bounds[2], bounds[3], rand());
    const path = 3.5 + Math.sin(z * 0.15) * 2;
    const bare = Math.abs(x - path) < 0.63;
    transform.position.set(x, height(x, z), z);
    transform.rotation.set((rand() - 0.5) * 0.15, rand() * 6.28, (rand() - 0.5) * 0.3);
    transform.scale.set(bare ? 0.002 : 0.012 + rand() * 0.025, bare ? 0.01 : 0.11 + rand() * 0.28, 1);
    transform.updateMatrix();
    blades.setMatrixAt(i, transform.matrix);
    color.setHSL(0.18 + rand() * 0.09, 0.27 + rand() * 0.25, 0.20 + rand() * 0.18);
    blades.setColorAt(i, color);
  }
  blades.receiveShadow = true;
  return blades;
}
