import { applyAfternoonSky, positionAfternoonSun } from './afternoonSky';
import { addVisibleSun } from './sunlight';
import { addStreetLamp } from './fixtures';
import * as THREE from 'three';
import { DEFAULT_POSE_LIMITS } from '../domain/camera';
import type { SceneDefinition } from './types';
import { createModeling, disposeScene, type Point } from './modeling';
import { createPortraitModel } from './human';
import { barkMaterial, branchGeometry, cherryTree, foliageMaterial, leafSpray, meadow } from './botanical';
import { makeBroadleafTree, seededRandom } from './helpers';
import { createSurface, fbm2D } from './textures';

const eye = new THREE.Vector3(-0.0305, 0.019, 0.0735)
  .applyEuler(new THREE.Euler(0.015, -0.12, -0.10)).add(new THREE.Vector3(0, 1.556, 0.014));
const eyePoint = { x: eye.x, y: eye.y, z: eye.z };

export const portraitScene: SceneDefinition = {
  id: 'portrait', name: '室外人像', subtitle: 'SPRING PORTRAIT · CLEAR AFTERNOON 16:00',
  defaultPose: { x: -0.50, y: 0.95, z: 4.40, yawDeg: -6.8, pitchDeg: -0.95 },
  cameraNear: 0.035, cameraFar: 65,
  poseLimits: { ...DEFAULT_POSE_LIMITS, minX: -6, maxX: 6, minZ: -3, maxZ: 9 },
  defaultFocusPoint: eyePoint,
  landmarks: [
    { id: 'eyes', label: '人物 · 眼睛', position: eyePoint },
    { id: 'shoulder', label: '近景 · 衣袖', position: { x: -0.17, y: 1.34, z: 0.05 } },
    { id: 'blossom', label: '樱花枝', position: { x: -0.6, y: 1.92, z: -0.7 } },
    { id: 'path', label: '远景 · 林荫步道', position: { x: 0.9, y: 0.06, z: -7.5 } },
  ],
  create() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#c5d9dc', 24, 60);
    const sky = applyAfternoonSky(scene, 'portrait');

    const { mesh } = createModeling(scene);
    const { actor } = createPortraitModel();
    scene.add(actor);
    const bark = barkMaterial(145);
    const green = foliageMaterial();
    // The canopy sits behind and above the subject, leaving the eye ray unobstructed.
    for (const [x, z, height, seed] of [[-1.05, -1.2, 3.2, 714], [1.7, -4.4, 4.3, 862], [-2.4, -7.3, 5.0, 937]] as const) {
      const tree = cherryTree(seed, height, bark);
      tree.position.set(x, -0.30, z);
      tree.rotation.y = seed * 0.04;
      scene.add(tree);
    }
    for (let i = 0; i < 4; i++) {
      const tree = makeBroadleafTree(4.5 + i * 0.5, 822 + i, bark, green);
      tree.position.set(i % 2 ? 3.5 : -3, 0, -5 - i * 3);
      scene.add(tree);
    }
    const bough: Point[] = [[-2, 1.32, -0.65], [-1.05, 1.77, -0.8], [0, 2.0, -1.0], [1.3, 2.16, -1.5]];
    mesh(branchGeometry(bough, 0.07, 0.012, 64), bark);
    scene.add(leafSpray(bough, 641, green, 90, 0.075));
    const groundSurface = createSurface({ size: 256, repeat: [12, 12], normalStrength: 1.7,
      height: (u, v) => fbm2D(u, v, 35, 35, 193),
      color: (_u, _v, h) => [0.32 + h * 0.25, 0.35 + h * 0.22, 0.21 + h * 0.17],
    });
    mesh(new THREE.PlaneGeometry(40, 45).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ ...groundSurface, roughness: 1 }), [0, -0.01, -10]);
    const gravel = createSurface({ size: 256, repeat: [4, 24], normalStrength: 2.5,
      height: (u, v) => fbm2D(u, v, 90, 90, 51),
      color: (_u, _v, h) => [0.58 + h * 0.21, 0.53 + h * 0.21, 0.43 + h * 0.20],
    });
    const path = new THREE.PlaneGeometry(1.7, 30, 8, 100).rotateX(-Math.PI / 2);
    const p = path.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) - 9;
      p.setXYZ(i, p.getX(i) + Math.sin(z * 0.09) * 0.65 + 0.65, 0.003, z);
    }
    path.computeVertexNormals();
    mesh(path, new THREE.MeshStandardMaterial({ ...gravel, roughness: 0.95 }));
    scene.add(meadow(() => 0, 682, [-7, 7, -14, 4], 5500));
    // Fallen petals are flat geometry on the path, rather than floating pink spheres.
    const petalGeometry = new THREE.SphereGeometry(1, 8, 4);
    const petals = new THREE.InstancedMesh(petalGeometry,
      new THREE.MeshStandardMaterial({ color: '#edc7cd', roughness: 0.85 }), 650);
    const rand = seededRandom(771), transform = new THREE.Object3D();
    for (let i = 0; i < petals.count; i++) {
      transform.position.set((rand() - 0.5) * 5, 0.008 + rand() * 0.003, 2 - rand() * 14);
      transform.rotation.set(0, rand() * 6.28, 0);
      transform.scale.set(0.008 + rand() * 0.004, 0.001, 0.012);
      transform.updateMatrix();
      petals.setMatrixAt(i, transform.matrix);
    }
    petals.receiveShadow = true;
    scene.add(petals);
    scene.add(new THREE.HemisphereLight('#e5eef2', '#636c46', 0.9));
    const sun = new THREE.DirectionalLight('#ffecd2', 3.4);
    sun.name = 'portrait-sunlight';
    sun.position.set(-3.2, 5.5, -2);
    sun.target.position.set(0, 1.3, 0);
    positionAfternoonSun(sun, 10, sky.sunDirection);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 });
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.0025;
    sun.shadow.radius = 1.5;
    scene.add(sun, sun.target);
    addVisibleSun(scene, sun, 48);
    // A park lantern on the right verge, behind the subject and clear of her outline.
    const beam = addStreetLamp(scene, [1.85, -0.01, -3.2], 2.65, [-0.65, 0, 0.1],
      [0.6, 0.03, -1.5], 220, 11);
    return { scene, sky, sunlight: { sun, beam, density: 0.016, distance: 18, groundHeight: 0, heightFalloff: 0.28 }, dispose() { disposeScene(scene); sky.dispose(); } };
  },
};
