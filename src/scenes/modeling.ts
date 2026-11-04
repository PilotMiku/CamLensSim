import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SurfaceTextures } from './textures';

export type Point = [number, number, number];

/** Small modelling vocabulary shared by the photographic sets. Units are metres. */
export function createModeling(parent: THREE.Object3D) {
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, position: Point = [0, 0, 0]) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const ellipsoid = (material: THREE.Material, position: Point, scale: Point, detail = 40) => {
    const object = mesh(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7)), material, position);
    object.scale.set(...scale);
    return object;
  };
  const tube = (material: THREE.Material, points: Point[], radius: number, segments = 32) =>
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, 6, false), material);
  const box = (material: THREE.Material, position: Point, size: Point, bevel = 0.01) =>
    mesh(new RoundedBoxGeometry(...size, 3, bevel), material, position);
  return { mesh, ellipsoid, tube, box };
}

/** Smooth the design profile before revolving it, retaining a closed solid rim. */
export function ceramicGeometry(profile: Array<[number, number]>, segments = 96) {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const points = curve.getPoints(profile.length * 6);
  points.forEach((p) => { p.x = Math.max(0, p.x); });
  return new THREE.LatheGeometry(points, segments);
}

export function surfaceMaterial(surface: SurfaceTextures, color: string, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({
    ...surface, color, roughness, normalScale: new THREE.Vector2(0.18, 0.18),
  });
}

/** Release shared and instanced resources once, including material-owned maps. */
export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((material) => materials.add(material));
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }
    if (object instanceof THREE.Light && 'shadow' in object) {
      (object as THREE.DirectionalLight).shadow?.dispose();
    }
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value: unknown) => {
      if (value instanceof THREE.Texture) textures.add(value);
    });
    material.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  scene.clear();
}

/** A cupped leaf with a centre ridge, tapered tip and real silhouette. */
export function leafGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 6;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const width = Math.pow(Math.sin(Math.PI * t), 0.85) * 0.28;
    for (let j = 0; j < 3; j++) {
      positions.push((j - 1) * width, t, 0.12 * t * t + (j === 1 ? 0.045 * Math.sin(Math.PI * t) : 0));
      uvs.push(j / 2, t);
    }
    if (i < rows) for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
