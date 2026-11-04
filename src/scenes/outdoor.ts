import { applyAfternoonSky, positionAfternoonSun } from './afternoonSky';
import { addVisibleSun } from './sunlight';
import * as THREE from 'three';
import { OUTDOOR_POSE_LIMITS } from '../domain/camera';
import type { SceneDefinition } from './types';
import { makeBroadleafTree, makePine, makeGrassTuft, seededRandom } from './helpers';
import { createModeling, disposeScene, surfaceMaterial } from './modeling';
import { createSurface, fbm2D } from './textures';
import { createLake } from './lake';
import { barkMaterial, foliageMaterial, meadow, blossomGeometry } from './botanical';

/** The lake is a real depression; terrain never covers the water inside its basin. */
export function terrainHeight(x: number, z: number): number {
  const distance = Math.hypot((x - 3) / 34, (z + 46) / 38);
  const shore = THREE.MathUtils.smoothstep(distance, 0.74, 1.0);
  const hills = Math.max(-0.25, 0.7 + 1.4 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06)
    + 0.35 * Math.sin(x * 0.31 + z * 0.19) + 0.12 * Math.cos(x * 0.7 - z * 0.53));
  return THREE.MathUtils.lerp(-2.2, hills, shore);
}

export const outdoorScene: SceneDefinition = {
  id: 'outdoor', name: '室外高山湖畔', subtitle: 'ALPINE LAKESIDE · CLEAR AFTERNOON 16:00',
  defaultPose: { x: 1.8, y: 4.4, z: 18, yawDeg: 2.5, pitchDeg: 3.2 },
  cameraNear: 0.10, cameraFar: 460,
  poseLimits: OUTDOOR_POSE_LIMITS,
  defaultFocusPoint: { x: -3.3, y: 3.4, z: -1.5 },
  landmarks: [
    { id: 'foreground', label: '前景 · 野花', position: { x: -1.2, y: terrainHeight(-1.2, 12) + 0.4, z: 12 } },
    { id: 'tree', label: '中景 · 桦树', position: { x: -3.3, y: 3.4, z: -1.5 } },
    { id: 'lake', label: '湖面', position: { x: 3, y: -0.8, z: -46 } },
    { id: 'mountain', label: '远山', position: { x: -6, y: 32, z: -130 } },
  ],
  create() {
    const scene = new THREE.Scene();
    // Clear alpine air retains a little blue atmospheric perspective at long distances.
    scene.fog = new THREE.FogExp2('#aacfea', 0.0018);
    const sky = applyAfternoonSky(scene, 'outdoor');
    const { mesh } = createModeling(scene);
    const rand = seededRandom(20240721);


    const groundSurface = createSurface({ size: 256, repeat: [50, 50], normalStrength: 2,
      height: (u, v) => fbm2D(u, v, 12, 12, 81),
      color: (_u, _v, h) => [0.33 + h * 0.19, 0.36 + h * 0.17, 0.22 + h * 0.15],
    });
    const groundMaterial = surfaceMaterial(groundSurface, '#d0cdb1');
    groundMaterial.vertexColors = true;
    const ground = new THREE.PlaneGeometry(340, 340, 220, 220).rotateX(-Math.PI / 2);
    const gp = ground.attributes.position;
    const colors: number[] = [];
    const color = new THREE.Color();
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), y = terrainHeight(x, z);
      gp.setY(i, y);
      const d = Math.hypot((x - 3) / 34, (z + 46) / 38);
      const beach = 1 - THREE.MathUtils.smoothstep(Math.abs(d - 1), 0.01, 0.15);
      color.set('#c3c6a6').lerp(new THREE.Color('#d8cbb0'), beach);
      colors.push(color.r, color.g, color.b);
    }
    ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    ground.computeVertexNormals();
    mesh(ground, groundMaterial);

    const reflection = createLake();
    scene.add(reflection.lake);
    // The far bank is interrupted by stones and reeds, rather than a rectangular plane edge.
    const rock = createSurface({ size: 256, repeat: [2, 2], normalStrength: 2.2,
      height: (u, v) => fbm2D(u, v, 18, 18, 117) * 0.6 + fbm2D(u, v, 80, 80, 118) * 0.25,
      color: (u, v, h) => { const moss = fbm2D(u, v, 6, 7, 19) > 0.64;
        return moss ? [0.29 + h * 0.13, 0.33 + h * 0.16, 0.16 + h * 0.1]
          : [0.40 + h * 0.20, 0.40 + h * 0.19, 0.35 + h * 0.18]; },
    });
    const stoneMaterial = surfaceMaterial(rock, '#e5e3d5', 0.93);
    for (let i = 0; i < 75; i++) {
      const angle = rand() * Math.PI * 2;
      const x = 3 + Math.cos(angle) * (31 + rand() * 5);
      const z = -46 + Math.sin(angle) * (35 + rand() * 4);
      const size = 0.2 + rand() * 0.8;
      const stone = mesh(new THREE.IcosahedronGeometry(size, 3), stoneMaterial, [x, Math.max(-1.05, terrainHeight(x, z)), z]);
      stone.scale.set(1.5, 0.5, 0.8 + rand());
      stone.rotation.set(rand(), rand() * 6.28, rand());
    }

    // Three true distant ridgelines, with relief, sediment variation and snow caps.
    for (let layer = 0; layer < 3; layer++) {
      const ridge = new THREE.PlaneGeometry(300, 76, 190, 70).rotateX(-Math.PI / 2);
      const rp = ridge.attributes.position;
      const ridgeColors: number[] = [];
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), localZ = rp.getZ(i);
        const peak = 19 + layer * 8 + 18 * Math.abs(Math.sin(x * 0.019 + layer * 1.7))
          + 9 * Math.sin(x * 0.059 + layer) + 4 * Math.sin(x * 0.13 + 0.5);
        const cross = Math.max(0, 1 - Math.abs(localZ) / 38);
        const noise = fbm2D((x + 150) / 300, (localZ + 38) / 76, 12, 6, 100 + layer, 6);
        const ridgeNoise = 1 - Math.abs(2 * noise - 1);
        const erosion = Math.pow(ridgeNoise, 2) * 7.5
          + 1.0 * Math.abs(Math.sin(x * 0.41 + localZ * 0.23));
        const height = -0.5 + peak * Math.pow(cross, 0.75) - cross * erosion;
        rp.setY(i, height);
      }
      ridge.computeVertexNormals();
      const normals = ridge.attributes.normal;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), z = rp.getZ(i), height = rp.getY(i);
        const noise = fbm2D((x + 150) / 300, (z + 38) / 76, 30, 20, 231 + layer, 3);
        const snow = THREE.MathUtils.smoothstep(height + noise * 9, 22 + layer * 4, 31 + layer * 4)
          * THREE.MathUtils.smoothstep(normals.getY(i), 0.35, 0.85);
        color.set(layer === 0 ? '#647573' : layer === 1 ? '#778e94' : '#9bafb8');
        color.multiplyScalar(0.75 + noise * 0.50);
        color.lerp(new THREE.Color('#edf0ea'), snow);
        ridgeColors.push(color.r, color.g, color.b);
      }
      ridge.setAttribute('color', new THREE.Float32BufferAttribute(ridgeColors, 3));
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98,
        normalMap: rock.normalMap, normalScale: new THREE.Vector2(0.26, 0.26) });
      mesh(ridge, material, [0, 0, -118 - layer * 48]);
    }

    const birch = barkMaterial(302);
    const trunkMaterial = barkMaterial(112);
    const leafMaterial = foliageMaterial();
    const pineMaterial = new THREE.MeshStandardMaterial({ color: '#c6ccab', roughness: 0.9 });
    for (const [x, z, height] of [[-4.8, 3.0, 8.5], [-7, -4, 7.7], [-9, -1, 5.2], [13, -11, 5.4]] as const) {
      const tree = makeBroadleafTree(height, Math.floor(rand() * 1e7), birch, leafMaterial);
      tree.position.set(x, terrainHeight(x, z), z);
      tree.rotation.y = rand() * 6.28;
      scene.add(tree);
    }
    for (let i = 0; i < 48; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (28 + rand() * 58), z = -22 - rand() * 100;
      const tree = makePine(3 + rand() * 6, 10000 + i, trunkMaterial, pineMaterial);
      tree.position.set(x, terrainHeight(x, z), z);
      scene.add(tree);
    }
    scene.add(meadow(terrainHeight, 492, [-15, 17, 4, 17], 18000));
    // Meadow blades are batched; the central sightline to the water stays open.
    const grass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    for (let i = 0; i < 42; i++) {
      const x = (rand() - 0.5) * 28, z = 5 + rand() * 12;
      const tuft = makeGrassTuft(new THREE.Vector3(x, terrainHeight(x, z), z), 14, 0.35 + rand() * 0.55, 0.5, i + 411, grass);
      if (tuft) scene.add(tuft);
    }
    const flowerMaterial = new THREE.MeshStandardMaterial({ color: '#fffdf0', vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    const wildflowers = new THREE.InstancedMesh(blossomGeometry(), flowerMaterial, 900);
    const transform = new THREE.Object3D();
    for (let i = 0; i < wildflowers.count; i++) {
      const x = -12 + rand() * 26, z = 6 + rand() * 11;
      const track = 3.5 + Math.sin(z * 0.15) * 2;
      transform.position.set(x, terrainHeight(x, z) + 0.12 + rand() * 0.23, z);
      transform.rotation.set(-Math.PI / 2 + rand() * 0.7, rand() * 6.28, rand());
      transform.scale.setScalar(Math.abs(x - track) < 0.65 ? 0.001 : 0.015 + rand() * 0.015);
      transform.updateMatrix();
      wildflowers.setMatrixAt(i, transform.matrix);
      color.set(i % 3 === 0 ? '#b9a6ce' : '#fff6d8');
      wildflowers.setColorAt(i, color);
    }
    wildflowers.receiveShadow = true;
    scene.add(wildflowers);

    // Narrow worn track follows the ground instead of floating above the hills.
    const path = new THREE.PlaneGeometry(1.15, 23, 4, 100).rotateX(-Math.PI / 2);
    const pp = path.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const z = pp.getZ(i) + 2;
      const x = pp.getX(i) + 3.5 + Math.sin(z * 0.15) * 2;
      pp.setXYZ(i, x, terrainHeight(x, z) + 0.018, z);
    }
    path.computeVertexNormals();
    mesh(path, new THREE.MeshStandardMaterial({ color: '#b2a486', roughness: 1 }));
    // Small foreground stones soften transitions between meadow and trail.
    for (let i = 0; i < 16; i++) {
      const x = -7 + rand() * 18, z = 6 + rand() * 9;
      const stone = mesh(new THREE.IcosahedronGeometry(0.18 + rand() * 0.3, 3), stoneMaterial, [x, terrainHeight(x, z), z]);
      stone.scale.set(1.3, 0.65, 1);
    }
    scene.add(new THREE.HemisphereLight('#cee6ff', '#80764e', 0.7));
    const sun = new THREE.DirectionalLight('#fff0d2', 4.2);
    sun.name = 'alpine-sunlight';
    sun.position.set(-30, 36, 12);
    sun.target.position.set(0, 0, -12);
    positionAfternoonSun(sun, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
    sun.shadow.normalBias = 0.03;
    sun.shadow.bias = -0.0002;
    sun.shadow.radius = 1.2;
    scene.add(sun, sun.target);
    addVisibleSun(scene, sun, 360);
    return { scene, sky, sunlight: { sun, density: 0.007, distance: 100, groundHeight: 0, heightFalloff: 0.1 }, setQuality: reflection.setQuality, dispose() { disposeScene(scene); reflection.target.dispose(); sky.dispose(); } };
  },
};
