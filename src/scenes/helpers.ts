import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { leafGeometry } from './modeling';

/** Deterministic PRNG so every scene is reproducible. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Revolve a 2D (radius, height) profile around the Y axis. */
export function latheGeometry(profile: Array<[number, number]>, segments = 64): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

/** Sweep a 2D (z, y) profile along the X axis into a seamless backdrop surface. */
export function sweepSurface(width: number, profile: Array<[number, number]>): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = width / 2;
  let distance = 0;
  const vValues: number[] = [0];
  for (let i = 1; i < profile.length; i++) {
    distance += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    vValues.push(distance);
  }
  for (let i = 0; i < profile.length; i++) {
    const [z, y] = profile[i];
    positions.push(-half, y, z, half, y, z);
    uvs.push(0, vValues[i] / 2.2, width / 2.2, vValues[i] / 2.2);
    if (i < profile.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Soft radial contact shadow card. */
export function addContactShadow(
  parent: THREE.Object3D,
  texture: THREE.Texture,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  opacity: number,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity,
    color: 0x16110c,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  parent.add(mesh);
  return mesh;
}

/** Branching broadleaf canopy made of individual cupped, instanced leaves. */
export function makeBroadleafTree(
  height: number, seed: number, trunkMaterial: THREE.Material, leafMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const rand = seededRandom(seed);
  const wood: THREE.BufferGeometry[] = [];
  const tapered = (curve: THREE.Curve<THREE.Vector3>, segments: number, radius: number, endRadius: number, sides: number) => {
    const geometry = new THREE.TubeGeometry(curve, segments, radius, sides);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = geometry.attributes.uv.getX(i), c = curve.getPointAt(t);
      const scale = THREE.MathUtils.lerp(1, endRadius / radius, t);
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * scale, c.y + (p.getY(i) - c.y) * scale, c.z + (p.getZ(i) - c.z) * scale);
    }
    geometry.computeVertexNormals();
    return geometry;
  };
  const tips: THREE.Vector3[] = [];
  const trunkPoints = [new THREE.Vector3(), new THREE.Vector3(height * 0.025, height * 0.32, 0),
    new THREE.Vector3(-height * 0.02, height * 0.63, height * 0.025), new THREE.Vector3(0, height * 0.87, 0)];
  wood.push(tapered(new THREE.CatmullRomCurve3(trunkPoints), 24, height * 0.023, height * 0.002, 10));
  for (let i = 0; i < 15; i++) {
    const t = i / 15;
    const angle = i * 2.39996 + rand() * 0.5;
    const reach = height * (0.3 - t * 0.12) * (0.85 + rand() * 0.3);
    const root = new THREE.Vector3(0, height * (0.28 + t * 0.43), 0);
    const elbow = root.clone().add(new THREE.Vector3(Math.cos(angle) * reach * 0.6, height * 0.13, Math.sin(angle) * reach * 0.6));
    const tip = root.clone().add(new THREE.Vector3(Math.cos(angle) * reach, height * (0.20 + rand() * 0.08), Math.sin(angle) * reach));
    wood.push(tapered(new THREE.CatmullRomCurve3([root, elbow, tip]), 14, height * (0.009 - t * 0.004), height * 0.001, 7));
    for (let j = 0; j < 3; j++) {
      const shoot = tip.clone().add(new THREE.Vector3((rand() - 0.5) * height * 0.18, height * (rand() * 0.1), (rand() - 0.5) * height * 0.18));
      wood.push(new THREE.TubeGeometry(new THREE.LineCurve3(elbow.clone().lerp(tip, 0.65), shoot), 2, height * 0.0025, 4));
      tips.push(shoot);
    }
  }
  const branches = mergeGeometries(wood, false);
  wood.forEach((geometry) => geometry.dispose());
  if (branches) {
    const mesh = new THREE.Mesh(branches, trunkMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const foliage = leafMaterial.clone();
  foliage.side = THREE.DoubleSide;
  const leaves = new THREE.InstancedMesh(leafGeometry(), foliage, 3000);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < leaves.count; i++) {
    const tip = tips[i % tips.length];
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * height * 0.14;
    transform.position.copy(tip).add(new THREE.Vector3(Math.cos(angle) * radius, (rand() - 0.5) * height * 0.16, Math.sin(angle) * radius));
    transform.rotation.set(rand() * 2.7, rand() * Math.PI * 2, rand() * Math.PI * 2);
    transform.scale.setScalar(0.14 + rand() * 0.12);
    transform.updateMatrix();
    leaves.setMatrixAt(i, transform.matrix);
    color.setHSL(0.21 + rand() * 0.065, 0.25 + rand() * 0.17, 0.26 + rand() * 0.23);
    leaves.setColorAt(i, color);
  }
  leaves.castShadow = leaves.receiveShadow = true;
  group.add(leaves);
  return group;
}

/** Conifer with irregular horizontal boughs and dense sprays of needles. */
export function makePine(
  height: number, seed: number, trunkMaterial: THREE.Material, leafMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const rand = seededRandom(seed);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.006, height * 0.025, height, 10), trunkMaterial);
  trunk.position.y = height * 0.5;
  trunk.castShadow = true;
  group.add(trunk);
  const needle = new THREE.ConeGeometry(1, 1, 5);
  needle.translate(0, 0.5, 0);
  const sprays = new THREE.InstancedMesh(needle, leafMaterial, 850);
  const object = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < sprays.count; i++) {
    const tier = Math.floor(rand() * 12);
    const t = tier / 12;
    const angle = (i % 7) / 7 * Math.PI * 2 + tier * 0.9;
    const radial = height * (0.28 * (1 - t)) * Math.pow(rand(), 0.5);
    object.position.set(Math.cos(angle) * radial, height * (0.23 + t * 0.72) - radial * 0.1, Math.sin(angle) * radial);
    object.rotation.set((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 1.2);
    object.scale.set(height * (0.018 + rand() * 0.016), height * (0.06 + rand() * 0.09), height * 0.025);
    object.updateMatrix();
    sprays.setMatrixAt(i, object.matrix);
    color.setHSL(0.32 + rand() * 0.05, 0.2 + rand() * 0.2, 0.2 + rand() * 0.2);
    sprays.setColorAt(i, color);
  }
  sprays.castShadow = sprays.receiveShadow = true;
  group.add(sprays);
  return group;
}

/** An open woody shrub with actual leaf silhouettes. */
export function makeShrub(size: number, seed: number, leafMaterial: THREE.Material): THREE.Group {
  const tree = makeBroadleafTree(size, seed, leafMaterial, leafMaterial);
  tree.scale.set(1.3, 0.7, 1.3);
  return tree;
}

/** A merged tuft of tapered grass blades with per-blade vertex colours. */
export function makeGrassTuft(
  origin: THREE.Vector3,
  count: number,
  height: number,
  spread: number,
  seed: number,
  material: THREE.Material,
): THREE.Mesh | null {
  const rand = seededRandom(seed);
  const blade = new THREE.Shape();
  blade.moveTo(-0.012, 0);
  blade.quadraticCurveTo(0.016, 0.45, 0.004, 1);
  blade.quadraticCurveTo(-0.018, 0.45, -0.012, 0);
  const base = new THREE.ShapeGeometry(blade, 6);
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geo = base.clone();
    const hue = 0.1 + rand() * 0.12;
    const color = new THREE.Color().setHSL(hue, 0.28, 0.2 + rand() * 0.16);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let v = 0; v < geo.attributes.position.count; v++) {
      colors[v * 3] = color.r;
      colors[v * 3 + 1] = color.g;
      colors[v * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const angle = rand() * Math.PI * 2;
    const lean = spread * (0.3 + rand() * 0.7);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      origin.clone().add(new THREE.Vector3((rand() - 0.5) * 0.2, 0, (rand() - 0.5) * 0.2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(angle) * lean, rand() * Math.PI, Math.sin(angle) * lean)),
      new THREE.Vector3(0.7 + rand() * 0.4, height * (0.55 + rand() * 0.6), 1),
    );
    geo.applyMatrix4(matrix);
    geometries.push(geo);
  }
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((item) => item.dispose());
  base.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A puffy cumulus cloud made from overlapping spheres (merged). */
export function makeCloud(
  origin: THREE.Vector3,
  size: number,
  seed: number,
): THREE.Mesh {
  const rand = seededRandom(seed);
  const geometries: THREE.BufferGeometry[] = [];
  const blobs = 8;
  for (let i = 0; i < blobs; i++) {
    const sphere = new THREE.SphereGeometry(1, 12, 10);
    const matrix = new THREE.Matrix4();
    const radius = size * (0.2 + rand() * 0.22);
    matrix.compose(
      origin.clone().add(new THREE.Vector3((rand() - 0.5) * size, (rand() - 0.5) * size * 0.3, (rand() - 0.5) * size * 0.6)),
      new THREE.Quaternion(),
      new THREE.Vector3(radius, radius * 0.55, radius * 0.7),
    );
    sphere.applyMatrix4(matrix);
    geometries.push(sphere);
  }
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((item) => item.dispose());
  return new THREE.Mesh(merged!);
}
