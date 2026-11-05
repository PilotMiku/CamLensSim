import * as THREE from 'three';
import { GradientEquirectTexture } from 'three-gpu-pathtracer';
import type { SceneInstance } from '../scenes/types';

/** Bake every instance into BVH geometry, including per-instance tint and mirrored winding. */
export function bakeInstances(mesh: THREE.InstancedMesh) {
  const source = mesh.geometry;
  const count = source.attributes.position.count, vertices = count * mesh.count;
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2), colors = new Float32Array(vertices * 3);
  const stride = source.index?.count ?? count;
  const indices = new Uint32Array(stride * mesh.count);
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const tint = new THREE.Color(), color = new THREE.Color(), sourceColor = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); normalMatrix.getNormalMatrix(matrix);
    tint.setRGB(1, 1, 1); if (mesh.instanceColor) mesh.getColorAt(i, tint);
    for (let j = 0; j < count; j++) {
      const v = i * count + j;
      point.fromBufferAttribute(source.attributes.position, j).applyMatrix4(matrix).toArray(positions, v * 3);
      if (source.attributes.normal) normal.fromBufferAttribute(source.attributes.normal, j).applyNormalMatrix(normalMatrix).toArray(normals, v * 3);
      if (source.attributes.uv) {
        uv[v * 2] = source.attributes.uv.getX(j); uv[v * 2 + 1] = source.attributes.uv.getY(j);
      }
      color.copy(tint);
      if (source.attributes.color) color.multiply(sourceColor.fromBufferAttribute(source.attributes.color, j));
      color.toArray(colors, v * 3);
    }
    const mirrored = matrix.determinant() < 0;
    for (let j = 0; j < stride; j += 3) {
      for (let k = 0; k < 3; k++) {
        const sourceIndex = j + (mirrored && k > 0 ? 3 - k : k);
        indices[i * stride + j + k] = i * count + (source.index?.getX(sourceIndex) ?? sourceIndex);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!source.attributes.normal) geometry.computeVertexNormals();
  for (let i = 0; i < mesh.count; i++) for (const group of source.groups) {
    geometry.addGroup(i * stride + group.start, group.count, group.materialIndex);
  }
  return geometry;
}

/** An independent physical scene: no mutation or disposal of the interactive scene. */
export function createPathTracingScene(world: SceneInstance) {
  const scene = new THREE.Scene();
  const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterials = new Set<THREE.Material>();
  const environment = world.sky?.environment.clone() ?? new GradientEquirectTexture(128);
  if (environment instanceof GradientEquirectTexture) {
    environment.topColor.set('#9cbdd7'); environment.bottomColor.set('#6a7056'); environment.update();
  }
  scene.environment = environment;
  scene.environmentIntensity = world.scene.environmentIntensity;
  scene.background = world.sky ? environment : world.scene.background instanceof THREE.Color ? world.scene.background.clone() : new THREE.Color('#b6c8d2');
  world.scene.updateMatrixWorld(true);
  world.scene.traverseVisible(object => {
    if (object instanceof THREE.Light && !(object instanceof THREE.HemisphereLight) && !(object instanceof THREE.AmbientLight)) {
      const light = object.clone(); light.position.setFromMatrixPosition(object.matrixWorld);
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
        const source = object as THREE.DirectionalLight;
        light.target = new THREE.Object3D(); light.target.position.setFromMatrixPosition(source.target.matrixWorld);
        scene.add(light.target);
      }
      scene.add(light); return;
    }
    if (!(object instanceof THREE.Mesh) || object.userData.pathTracingExclude) return;
    // The sun is an infinitely distant light, never an opaque disc in the BVH.
    // castShadow=false is insufficient here: the tracer still intersects that
    // surface on specular paths. Its visible disc belongs to the HDR sky instead.
    if (object.parent?.name === 'visible-sun') return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    if (list.some(m => m instanceof THREE.MeshBasicMaterial && m.side === THREE.BackSide && !m.depthWrite)) return;
    const water = object.name === 'alpine-lake-reflection';
    // Shader sky domes are replaced by the environment; screen glow has no physical surface.
    if (!water && list.some(m => !(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshBasicMaterial))) return;
    const materials = list.map(source => {
      let material: THREE.MeshStandardMaterial;
      if (water) {
        material = new THREE.MeshPhysicalMaterial({ color: '#b8d9d8', roughness: 0.055,
          metalness: 0, transmission: 0.65, thickness: 2, ior: 1.333, side: THREE.DoubleSide });
      } else if (source instanceof THREE.MeshStandardMaterial) {
        material = source.clone();
      } else {
        const basic = source as THREE.MeshBasicMaterial;
        material = new THREE.MeshStandardMaterial({ color: basic.color, map: basic.map,
          emissive: basic.color, emissiveMap: basic.map, side: basic.side,
          transparent: basic.transparent, opacity: basic.opacity, roughness: 1 });
      }
      if (object.userData.pathTracingShadowTransparent) Object.assign(material, { castShadow: false });
      material.vertexColors ||= object instanceof THREE.InstancedMesh;
      ownedMaterials.add(material); return material;
    });
    const geometry = object instanceof THREE.InstancedMesh ? bakeInstances(object) : object.geometry.clone();
    ownedGeometry.add(geometry);
    const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? materials : materials[0]);
    mesh.name = object.name;
    mesh.matrix.copy(object.matrixWorld); mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  });
  // Single scattering is integrated by the shared shadow-tested sunlight pass.
  // A stochastic fog volume here would add low-sample noise and double the medium.
  return { scene, dispose() {
    ownedGeometry.forEach(g => g.dispose()); ownedMaterials.forEach(m => m.dispose()); environment.dispose(); scene.clear();
  } };
}
