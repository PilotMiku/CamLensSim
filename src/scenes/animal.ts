import { applyAfternoonSky, positionAfternoonSun } from './afternoonSky';
import { addVisibleSun } from './sunlight';
import { addStreetLamp } from './fixtures';
import * as THREE from 'three';
import { DEFAULT_POSE_LIMITS } from '../domain/camera';
import type { SceneDefinition } from './types';
import { makeBroadleafTree, seededRandom } from './helpers';
import { createModeling, disposeScene, leafGeometry } from './modeling';
import { createRobin } from './robin';
import { barkMaterial, foliageMaterial, leafSpray } from './botanical';

export const animalScene: SceneDefinition = {
  id: 'animal', name: '林间知更鸟', subtitle: 'WOODLAND ROBIN · CLEAR AFTERNOON 16:00',
  defaultPose: { x: 0, y: 2.13, z: 2.55, yawDeg: 0, pitchDeg: -1.5 },
  cameraNear: 0.04, cameraFar: 35,
  poseLimits: { ...DEFAULT_POSE_LIMITS, minZ: -1.5, maxZ: 7 },
  defaultFocusPoint: { x: 0.0206, y: 2.0884, z: 0.0546 },
  landmarks: [
    { id: 'eye', label: '近侧眼睛', position: { x: 0.0206, y: 2.0884, z: 0.0546 } },
    { id: 'body', label: '胸部羽毛', position: { x: 0.018, y: 2.02, z: 0.055 } },
    { id: 'tail', label: '尾羽', position: { x: -0.0832, y: 2.006, z: -0.0808 } },
    { id: 'bokeh', label: '林间光隙', position: { x: -0.9, y: 2.4, z: -4.2 } },
  ],
  create() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#bdd5d5', 22, 50);
    const sky = applyAfternoonSky(scene, 'animal');

    // Blue sky and a solar disc remain visible through openings in the canopy.

    const { mesh, tube, ellipsoid } = createModeling(scene);
    const rand = seededRandom(991827);
    const branchMaterial = barkMaterial(71);
    const green = foliageMaterial();

    // A tapered, knotty perch and offshoots, with a cut cross-section at one end.
    const branchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.5, 1.77, -0.12), new THREE.Vector3(-0.5, 1.86, -0.05),
      new THREE.Vector3(0.3, 1.88, 0.03), new THREE.Vector3(1.2, 2.03, -0.08),
    ]);
    const branch = new THREE.TubeGeometry(branchCurve, 80, 0.037, 14, false);
    const bp = branch.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const t = branch.attributes.uv.getX(i);
      const center = branchCurve.getPointAt(t);
      const taper = 1.25 - t * 0.55;
      bp.setXYZ(i, center.x + (bp.getX(i) - center.x) * taper,
        center.y + (bp.getY(i) - center.y) * taper, center.z + (bp.getZ(i) - center.z) * taper);
    }
    branch.computeVertexNormals();
    mesh(branch, branchMaterial, [0, 0.06, 0]);
    for (const side of [-1, 1]) {
      tube(branchMaterial, [[side * 0.63, 1.96, 0], [side * 0.82, 2.10, -0.02],
        [side * 1.07, 2.18, -0.06], [side * 1.22, 2.26, -0.05]], 0.008);
    }
    const leaves = new THREE.InstancedMesh(leafGeometry(), green, 65);
    const transform = new THREE.Object3D();
    for (let i = 0; i < leaves.count; i++) {
      const side = i % 2 ? 1 : -1;
      transform.position.set(side * (0.66 + rand() * 0.55), 2.00 + rand() * 0.23, -0.08 + rand() * 0.09);
      transform.rotation.set(rand() * 1.8, rand() * 6.28, side * (0.3 + rand() * 1.5));
      transform.scale.setScalar(0.09 + rand() * 0.08);
      transform.updateMatrix();
      leaves.setMatrixAt(i, transform.matrix);
    }
    leaves.castShadow = leaves.receiveShadow = true;
    scene.add(leaves);
    // Small lichen rosettes break up the smooth branch silhouette.
    const lichen = new THREE.MeshStandardMaterial({ color: '#a0a272', roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const t = rand();
      const p = branchCurve.getPointAt(t);
      ellipsoid(lichen, [p.x, p.y + 0.095, p.z], [0.008 + rand() * 0.013, 0.003, 0.01], 12);
    }

    scene.add(createRobin());

    // Actual background branches and leaves replace spherical foliage blobs.
    for (let i = 0; i < 9; i++) {
      const tree = makeBroadleafTree(4 + rand() * 2.5, 4100 + i, branchMaterial, green);
      tree.position.set((rand() - 0.5) * 10, -0.5, -3 - rand() * 8);
      scene.add(tree);
    }
    scene.add(leafSpray([[-1.5, 1.5, 1.15], [-1.05, 1.8, 1.1], [-0.75, 1.9, 1.0]], 6821, green, 48, 0.20));
    scene.add(leafSpray([[0.9, 2.7, 0.6], [1.4, 2.8, 0.4], [1.9, 2.9, 0.1]], 6822, green, 65, 0.16));
    // Crusted lichen and moss tuft geometry sit on the actual perch surface.
    const moss = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#7f8950', roughness: 1 }), 600);
    for (let i = 0; i < moss.count; i++) {
      const p = branchCurve.getPointAt(rand()), angle = rand() * Math.PI;
      transform.position.set(p.x, p.y + 0.06 + Math.sin(angle) * 0.037, p.z + Math.cos(angle) * 0.037);
      transform.rotation.set(rand(), rand(), rand());
      transform.scale.set(0.002 + rand() * 0.008, 0.001 + rand() * 0.003, 0.004 + rand() * 0.008);
      transform.updateMatrix();
      moss.setMatrixAt(i, transform.matrix);
    }
    moss.castShadow = moss.receiveShadow = true;
    scene.add(moss);
    mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#495a34', roughness: 1 }), [0, -0.2, 0]);
    // A walking trail behind the perch gives the park light a grounded purpose.
    mesh(new THREE.PlaneGeometry(1.2, 18).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#8a8067', roughness: 1 }), [1.1, -0.192, -7]).name = 'woodland-walking-trail';
    scene.add(new THREE.HemisphereLight('#d6eaff', '#70613c', 0.7));
    const key = new THREE.DirectionalLight('#fff0d2', 4.1);
    key.name = 'woodland-sunlight';
    key.position.set(-3.5, 6, 2.5);
    key.target.position.set(0, 2, 0);
    positionAfternoonSun(key, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
    key.shadow.normalBias = 0.0015;
    key.shadow.bias = -0.00015;
    key.shadow.radius = 1.0;
    scene.add(key, key.target);
    addVisibleSun(scene, key, 28);
    const beam = addStreetLamp(scene, [0.2, -0.2, -2.4], 3.0, [0.65, 0, 0],
      [1.1, -0.18, -1.0], 200, 11);
    return { scene, sky, sunlight: { sun: key, beam, density: 0.018, distance: 20, groundHeight: 1, heightFalloff: 0.22 }, dispose() { disposeScene(scene); sky.dispose(); } };
  },
};
