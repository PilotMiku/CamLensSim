import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_POSE_LIMITS } from '../domain/camera';
import { DEFAULT_FOCUS_POINT, DEFAULT_POSE } from '../data/equipment';
import type { SceneDefinition } from './types';
import { ceramicGeometry, createModeling, disposeScene } from './modeling';
import { blossomGeometry, foliageMaterial } from './botanical';
import { makeBroadleafTree } from './helpers';
import { applyAfternoonSky, positionAfternoonSun } from './afternoonSky';
import { addVisibleSun } from './sunlight';
import { addPendantLamp } from './fixtures';
import {
  createArtworkTexture,
  createContactShadowTexture,
  createLinenSurface,
  createPaperSurface,
  createPlasterSurface,
  createStonewareSurface,
  createWoodSurface,
  type SurfaceTextures,
} from './textures';

/** World units are metres; the subject table top sits at y = 0.78. */
const TABLE_TOP = 0.78;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function addContactShadow(
  parent: THREE.Object3D,
  texture: THREE.Texture,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  opacity: number,
) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity,
    color: 0x1b1712,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.name = 'raster-contact-shadow';
  mesh.userData.pathTracingExclude = true;
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  parent.add(mesh);
  return mesh;
}

export const indoorScene: SceneDefinition = {
  id: 'indoor',
  name: '室内静物',
  subtitle: 'CERAMIC ATELIER · CLEAR AFTERNOON 16:00',
  defaultPose: { ...DEFAULT_POSE },
  cameraNear: 0.08,
  cameraFar: 60,
  poseLimits: DEFAULT_POSE_LIMITS,
  defaultFocusPoint: { ...DEFAULT_FOCUS_POINT },
  landmarks: [
    { id: 'foreground', label: '前景 · 草叶', position: { x: -0.62, y: 1.1, z: 1.12 } },
    { id: 'books', label: '中景 · 书册', position: { x: -0.6, y: 0.86, z: 0.18 } },
    { id: 'subject', label: '主体 · 陶瓶', position: { x: -0.18, y: 1.08, z: -0.05 } },
    { id: 'background', label: '背景 · 花器', position: { x: 1.15, y: 0.5, z: -1.7 } },
    { id: 'backdrop', label: '远景 · 画框', position: { x: 0.78, y: 1.7, z: -2.56 } },
  ],
  create() {
    const scene = new THREE.Scene();
    const sky = applyAfternoonSky(scene, 'indoor');

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    const registerTextures = (surface: SurfaceTextures) => {
      textures.add(surface.map);
      textures.add(surface.normalMap);
      if (surface.roughnessMap) textures.add(surface.roughnessMap);
      return surface;
    };

    const plaster = registerTextures(createPlasterSurface());
    const wood = registerTextures(createWoodSurface());
    const linen = registerTextures(createLinenSurface());
    const stoneware = registerTextures(createStonewareSurface(317, [0.58, 0.32, 0.19]));
    const tealWare = registerTextures(createStonewareSurface(613, [0.14, 0.3, 0.27]));
    const ashWare = registerTextures(createStonewareSurface(827, [0.52, 0.5, 0.45]));
    const paper = registerTextures(createPaperSurface());
    const artworkTexture = createArtworkTexture();
    const contactTexture = createContactShadowTexture();
    textures.add(artworkTexture);
    textures.add(contactTexture);

    const material = (parameters: THREE.MeshStandardMaterialParameters) => {
      const item = new THREE.MeshStandardMaterial(parameters);
      materials.add(item);
      return item;
    };

    const plasterMaterial = material({
      map: plaster.map,
      normalMap: plaster.normalMap,
      roughnessMap: plaster.roughnessMap,
      color: '#ffffff',
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const woodMaterial = material({
      map: wood.map,
      normalMap: wood.normalMap,
      roughnessMap: wood.roughnessMap,
      color: '#ffffff',
      roughness: 0.72,
      metalness: 0,
      normalScale: new THREE.Vector2(0.24, 0.24),
    });
    const darkWoodMaterial = material({
      map: wood.map,
      normalMap: wood.normalMap,
      roughnessMap: wood.roughnessMap,
      color: '#8b7a68',
      roughness: 1,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const linenMaterial = material({
      map: linen.map,
      normalMap: linen.normalMap,
      roughnessMap: linen.roughnessMap,
      color: '#cfc2ac',
      roughness: 1,
      normalScale: new THREE.Vector2(0.6, 0.6),
      side: THREE.DoubleSide,
    });
    const stonewareMaterial = material({
      map: stoneware.map,
      normalMap: stoneware.normalMap,
      roughnessMap: stoneware.roughnessMap,
      color: '#ffffff',
      roughness: 0.56,
      metalness: 0,
      normalScale: new THREE.Vector2(0.20, 0.20),
      side: THREE.DoubleSide,
    });
    const tealMaterial = material({
      map: tealWare.map,
      normalMap: tealWare.normalMap,
      roughnessMap: tealWare.roughnessMap,
      color: '#ffffff',
      roughness: 0.32,
      normalScale: new THREE.Vector2(0.16, 0.16),
      side: THREE.DoubleSide,
    });
    const ashMaterial = material({
      map: ashWare.map,
      normalMap: ashWare.normalMap,
      roughnessMap: ashWare.roughnessMap,
      color: '#ffffff',
      roughness: 1,
      normalScale: new THREE.Vector2(0.45, 0.45),
      side: THREE.DoubleSide,
    });
    const paperMaterial = material({
      map: paper.map,
      normalMap: paper.normalMap,
      color: '#ffffff',
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const brassMaterial = material({
      color: '#c9a269',
      metalness: 1,
      roughness: 0.3,
      envMapIntensity: 1.3,
    });
    const leafMaterial = material({
      color: '#ffffff',
      roughness: 0.62,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const stemMaterial = material({ color: '#5f4c37', roughness: 0.85 });
    const grassMaterial = material({
      color: '#ffffff',
      roughness: 0.7,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const artworkMaterial = material({
      map: artworkTexture,
      roughness: 0.86,
      side: THREE.DoubleSide,
    });

    const add = (
      geometry: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = scene,
      castShadow = true,
    ) => {
      const item = new THREE.Mesh(geometry, mat);
      item.position.set(x, y, z);
      item.castShadow = castShadow;
      item.receiveShadow = true;
      parent.add(item);
      geometries.add(geometry);
      return item;
    };

    // ---------------------------------------------------------------- room ---
    // Solid room walls leave a real opening for the window and sunlight.
    const room = createModeling(scene);
    room.mesh(new THREE.PlaneGeometry(10, 12).rotateX(-Math.PI / 2), plasterMaterial);
    room.box(plasterMaterial, [-3.235, 1.8, -2.64], [2.53, 3.6, 0.08], 0.002);
    room.box(plasterMaterial, [1.83, 1.8, -2.64], [5.33, 3.6, 0.08], 0.002);
    room.box(plasterMaterial, [-1.40, 0.455, -2.64], [1.13, 0.91, 0.08], 0.002);
    room.box(plasterMaterial, [-1.40, 3.125, -2.64], [1.13, 1.0, 0.08], 0.002);
    // Enclose the studio so traced sky light enters through the actual window.
    room.box(plasterMaterial, [-4.5, 1.8, 1.3], [0.08, 3.6, 7.8], 0.002);
    room.box(plasterMaterial, [4.5, 1.8, 1.3], [0.08, 3.6, 7.8], 0.002);
    room.box(plasterMaterial, [0, 3.64, 1.3], [9.08, 0.08, 7.8], 0.002);
    room.box(plasterMaterial, [0, 1.8, 5.2], [9.08, 3.6, 0.08], 0.002);
    const exteriorLeaf = foliageMaterial();
    for (let i = 0; i < 3; i++) {
      const tree = makeBroadleafTree(3.8 + i * 0.4, 740 + i, stemMaterial, exteriorLeaf);
      tree.position.set(-1.8 + i * 0.8, -0.7, -4.7 - i * 1.3);
      scene.add(tree);
    }

    // ----------------------------------------------------------------- table ---
    const tableGroup = new THREE.Group();
    scene.add(tableGroup);
    const topGeometry = new THREE.CylinderGeometry(0.84, 0.84, 0.062, 96, 1);
    const tableTop = new THREE.Mesh(topGeometry, woodMaterial);
    tableTop.name = 'tabletop';
    tableTop.position.set(0, TABLE_TOP - 0.031, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);
    geometries.add(topGeometry);
    // A small rounded rim keeps the tabletop silhouette from looking extruded.
    const rimGeometry = new THREE.TorusGeometry(0.83, 0.014, 10, 96);
    const tableRim = new THREE.Mesh(rimGeometry, woodMaterial);
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.set(0, TABLE_TOP - 0.014, 0);
    tableRim.castShadow = true;
    tableRim.receiveShadow = true;
    tableGroup.add(tableRim);
    geometries.add(rimGeometry);
    const pedestalProfile: Array<[number, number]> = [
      [0, 0],
      [0.36, 0],
      [0.375, 0.025],
      [0.3, 0.055],
      [0.17, 0.12],
      [0.125, 0.28],
      [0.135, 0.42],
      [0.19, 0.56],
      [0.205, 0.66],
      [0.16, 0.71],
      [0, 0.72],
    ];
    const pedestal = ceramicGeometry(pedestalProfile);
    const pedestalMesh = new THREE.Mesh(pedestal, darkWoodMaterial);
    pedestalMesh.position.y = 0;
    pedestalMesh.castShadow = true;
    pedestalMesh.receiveShadow = true;
    tableGroup.add(pedestalMesh);
    geometries.add(pedestal);
    addContactShadow(tableGroup, contactTexture, 0, 0.004, 0, 2.6, 2.6, 0.34);
    addContactShadow(tableGroup, contactTexture, 0, TABLE_TOP + 0.003, 0, 0.9, 0.9, 0.22);

    // Coiled linen runner under the vase.
    const clothGeometry = new THREE.PlaneGeometry(0.49, 1.30, 48, 80);
    const clothPosition = clothGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < clothPosition.count; i++) {
      const x = clothPosition.getX(i);
      const z = clothPosition.getY(i) + 0.24;
      const edge = Math.sqrt(Math.max(0, 0.825 ** 2 - (x - 0.12) ** 2));
      const overhang = Math.max(0, z - edge);
      const fold = 0.012 + 0.004 * Math.sin(x * 65 + z * 6)
        + 0.003 * Math.sin(z * 28 - x * 12);
      clothPosition.setXYZ(i, x - 0.12, TABLE_TOP + fold - overhang * 3.8, z);
    }
    clothGeometry.computeVertexNormals();
    const cloth = new THREE.Mesh(clothGeometry, linenMaterial);
    cloth.name = 'linen-runner';
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    scene.add(cloth);
    geometries.add(clothGeometry);

    // -------------------------------------------------------------- vase -----
    const vaseProfile: Array<[number, number]> = [
      [0, 0],
      [0.1, 0.004],
      [0.15, 0.03],
      [0.188, 0.1],
      [0.198, 0.18],
      [0.19, 0.27],
      [0.163, 0.35],
      [0.126, 0.41],
      [0.1, 0.45],
      [0.094, 0.5],
      [0.106, 0.545],
      [0.1, 0.568],
      [0.072, 0.57],
      [0.068, 0.55],
    ];
    const vaseGeometry = ceramicGeometry(vaseProfile);
    const vase = add(vaseGeometry, stonewareMaterial, -0.18, TABLE_TOP + 0.006, -0.05);
    vase.scale.set(1, 1, 0.95);
    addContactShadow(scene, contactTexture, -0.18, TABLE_TOP + 0.008, -0.05, 0.52, 0.52, 0.3);

    const blossomPoints: THREE.Vector3[] = [];
    const stemGeometries: THREE.BufferGeometry[] = [];
    const leafGeometries: THREE.BufferGeometry[] = [];
    const leafBase = new THREE.ShapeGeometry(
      (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.5);
        shape.quadraticCurveTo(0.27, -0.1, 0.1, 0.24);
        shape.quadraticCurveTo(0.02, 0.5, 0, 0.66);
        shape.quadraticCurveTo(-0.02, 0.5, -0.1, 0.24);
        shape.quadraticCurveTo(-0.27, -0.1, 0, -0.5);
        return shape;
      })(),
      8,
    );
    const random = seededRandom(9127);
    const vaseMouth = new THREE.Vector3(-0.18, TABLE_TOP + 0.57, -0.05);
    const stemCount = 9;
    for (let s = 0; s < stemCount; s++) {
      const angle = (s / stemCount) * Math.PI * 2 + random() * 0.5;
      const reach = 0.85 + random() * 0.42;
      const start = vaseMouth
        .clone()
        .add(new THREE.Vector3(Math.cos(angle) * 0.045, 0, Math.sin(angle) * 0.045));
      const tip = start
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * (0.34 + random() * 0.22),
            0.34 + random() * 0.3,
            Math.sin(angle) * (0.3 + random() * 0.2),
          ),
        );
      const control = start
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * 0.06,
            reach * 0.5,
            Math.sin(angle) * 0.05,
          ),
        );
      const curve = new THREE.QuadraticBezierCurve3(start, control, tip);
      const tube = new THREE.TubeGeometry(curve, 22, 0.0042, 5, false);
      stemGeometries.push(tube);
      const leaves = 15;
      for (let i = 0; i < leaves; i++) {
        const t = 0.2 + (i / (leaves - 1)) * 0.74;
        const point = curve.getPoint(t);
        if (i % 2 === 0 && t > 0.35) {
          for (let flower = 0; flower < 6; flower++) blossomPoints.push(point.clone().add(
            new THREE.Vector3((random() - 0.5) * 0.055, (random() - 0.5) * 0.055, (random() - 0.5) * 0.055)));
        }
        const side = i % 2 === 0 ? 1 : -1;
        const leaf = leafBase.clone();
        const hueShift = random();
        const color = new THREE.Color().setHSL(
          0.2 + hueShift * 0.06,
          0.2 + random() * 0.14,
          0.24 + random() * 0.12,
        );
        const colors = new Float32Array(leaf.attributes.position.count * 3);
        for (let v = 0; v < leaf.attributes.position.count; v++) {
          colors[v * 3] = color.r;
          colors[v * 3 + 1] = color.g;
          colors[v * 3 + 2] = color.b;
        }
        leaf.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const scale = 0.072 + random() * 0.036;
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            0.5 + random() * 0.6,
            angle + side * 0.9 + random() * 0.5,
            side * (0.9 + random() * 0.6),
          ),
        );
        matrix.compose(
          point.clone().add(new THREE.Vector3(Math.cos(angle) * 0.016, 0, Math.sin(angle) * 0.016)),
          quaternion,
          new THREE.Vector3(scale * 0.72, scale, scale),
        );
        leaf.applyMatrix4(matrix);
        leafGeometries.push(leaf);
      }
    }
    const mergedStems = mergeGeometries(stemGeometries, false);
    stemGeometries.forEach((item) => item.dispose());
    if (mergedStems) {
      const stems = new THREE.Mesh(mergedStems, stemMaterial);
      stems.castShadow = true;
      scene.add(stems);
      geometries.add(mergedStems);
    }
    const mergedLeaves = mergeGeometries(leafGeometries, false);
    leafGeometries.forEach((item) => item.dispose());
    leafBase.dispose();
    if (mergedLeaves) {
      const leaves = new THREE.Mesh(mergedLeaves, leafMaterial);
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      scene.add(leaves);
      geometries.add(mergedLeaves);
    }

    // ------------------------------------------------------------- pitcher ---
    const pitcherProfile: Array<[number, number]> = [
      [0, 0],
      [0.1, 0],
      [0.135, 0.02],
      [0.152, 0.09],
      [0.15, 0.18],
      [0.132, 0.25],
      [0.1, 0.29],
      [0.094, 0.33],
      [0.082, 0.345],
      [0.075, 0.33],
    ];
    const pitcherGeometry = ceramicGeometry(pitcherProfile);
    add(pitcherGeometry, tealMaterial, 0.36, TABLE_TOP + 0.004, 0.06).scale.set(1, 1, 0.96);
    const handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.1, 0.27, 0),
      new THREE.Vector3(0.19, 0.245, 0),
      new THREE.Vector3(0.21, 0.13, 0),
      new THREE.Vector3(0.125, 0.055, 0),
    ]);
    const handleGeometry = new THREE.TubeGeometry(handleCurve, 24, 0.011, 8, false);
    add(handleGeometry, tealMaterial, 0.36, TABLE_TOP + 0.004, 0.06);
    addContactShadow(scene, contactTexture, 0.36, TABLE_TOP + 0.006, 0.06, 0.42, 0.42, 0.28);

    // ---------------------------------------------------------------- bowl ---
    const bowlProfile: Array<[number, number]> = [
      [0, 0],
      [0.08, 0],
      [0.12, 0.01],
      [0.16, 0.05],
      [0.172, 0.085],
      [0.168, 0.095],
      [0.155, 0.075],
      [0.12, 0.035],
      [0.08, 0.022],
      [0, 0.022],
    ];
    const bowlGeometry = ceramicGeometry(bowlProfile);
    add(bowlGeometry, brassMaterial, 0.42, TABLE_TOP + 0.004, 0.44);
    const figMaterial = material({ color: '#5b4132', roughness: 0.55 });
    for (const [fx, fz, scale] of [
      [0.4, 0.42, 1],
      [0.47, 0.47, 0.86],
    ] as const) {
      const fig = new THREE.Mesh(new THREE.SphereGeometry(0.062 * scale, 24, 18), figMaterial);
      fig.scale.y = 0.86;
      fig.position.set(fx, TABLE_TOP + 0.078, fz);
      fig.castShadow = true;
      fig.receiveShadow = true;
      scene.add(fig);
      geometries.add(fig.geometry);
    }
    addContactShadow(scene, contactTexture, 0.42, TABLE_TOP + 0.006, 0.44, 0.5, 0.5, 0.26);

    // --------------------------------------------------------------- books ---
    const bookGroup = new THREE.Group();
    bookGroup.position.set(-0.66, TABLE_TOP + 0.004, 0.22);
    bookGroup.rotation.y = -0.22;
    scene.add(bookGroup);
    const bookMaterials = [
      material({ color: '#4c5a4b', roughness: 0.86 }),
      material({ color: '#a8734a', roughness: 0.82 }),
      material({ color: '#d8cbb2', roughness: 0.9 }),
    ];
    const pageMaterial = material({ color: '#efe7d3', roughness: 0.95 });
    const bookSpecs: Array<[number, number, number, number]> = [
      [0.34, 0.036, 0.24, 0],
      [0.31, 0.03, 0.22, 0.013],
      [0.29, 0.026, 0.2, -0.02],
    ];
    let stackY = 0;
    bookSpecs.forEach(([width, height, depth, rotation], index) => {
      const group = new THREE.Group();
      group.position.set(0, stackY, 0);
      group.rotation.y = rotation;
      bookGroup.add(group);
      const pages = new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.96, height * 0.72, depth * 0.96, 2, 0.004),
        pageMaterial,
      );
      pages.position.y = height * 0.5;
      pages.castShadow = true;
      pages.receiveShadow = true;
      group.add(pages);
      geometries.add(pages.geometry);
      const coverMaterial = bookMaterials[index % bookMaterials.length];
      const topCover = new THREE.Mesh(
        new RoundedBoxGeometry(width, height * 0.16, depth, 2, 0.005),
        coverMaterial,
      );
      topCover.position.y = height * 0.92;
      topCover.castShadow = true;
      topCover.receiveShadow = true;
      group.add(topCover);
      geometries.add(topCover.geometry);
      const bottomCover = new THREE.Mesh(
        new RoundedBoxGeometry(width, height * 0.16, depth, 2, 0.005),
        coverMaterial,
      );
      bottomCover.position.y = height * 0.08;
      bottomCover.castShadow = true;
      bottomCover.receiveShadow = true;
      group.add(bottomCover);
      geometries.add(bottomCover.geometry);
      const spine = new THREE.Mesh(
        new RoundedBoxGeometry(height * 0.9, height * 0.86, depth * 0.98, 2, 0.004),
        coverMaterial,
      );
      spine.rotation.z = Math.PI / 2;
      spine.position.set(-width * 0.5, height * 0.5, 0);
      spine.castShadow = true;
      group.add(spine);
      geometries.add(spine.geometry);
      stackY += height;
    });
    addContactShadow(scene, contactTexture, -0.66, TABLE_TOP + 0.006, 0.22, 0.6, 0.5, 0.26);

    // ----------------------------------------------------------- floor vase ---
    const floorVaseProfile: Array<[number, number]> = [
      [0, 0],
      [0.17, 0],
      [0.22, 0.04],
      [0.245, 0.16],
      [0.235, 0.32],
      [0.2, 0.44],
      [0.16, 0.5],
      [0.15, 0.56],
      [0.17, 0.6],
      [0.16, 0.62],
    ];
    const floorVaseGeometry = ceramicGeometry(floorVaseProfile);
    add(floorVaseGeometry, ashMaterial, 1.15, 0.005, -1.7);
    addContactShadow(scene, contactTexture, 1.15, 0.006, -1.7, 0.9, 0.9, 0.3);
    const branchGeometries: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const start = new THREE.Vector3(1.15, 0.58, -1.7);
      const tip = start.clone().add(
        new THREE.Vector3(
          (random() - 0.5) * 0.5,
          0.5 + random() * 0.4,
          (random() - 0.5) * 0.3,
        ),
      );
      const curve = new THREE.QuadraticBezierCurve3(
        start,
        start.clone().add(new THREE.Vector3(0, 0.3, 0)),
        tip,
      );
      branchGeometries.push(new THREE.TubeGeometry(curve, 14, 0.005, 4, false));
    }
    const mergedBranches = mergeGeometries(branchGeometries, false);
    branchGeometries.forEach((item) => item.dispose());
    if (mergedBranches) {
      const branchMesh = new THREE.Mesh(mergedBranches, stemMaterial);
      branchMesh.castShadow = true;
      scene.add(branchMesh);
      geometries.add(mergedBranches);
    }

    // ------------------------------------------------ bokeh light strand ---
    // Small warm bulbs far behind the subject: defocused highlights reveal the
    // aperture blade shape, which is one of the clearest depth-of-field cues.
    const bulbMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(7.5, 4.9, 2.7),
      toneMapped: false,
    });
    materials.add(bulbMaterial);
    const bulbGeometry = new THREE.SphereGeometry(0.016, 16, 10);
    geometries.add(bulbGeometry);
    const bulbs: Array<[number, number, number]> = [
      [1.02, 1.28, -2.35],
      [1.24, 1.14, -2.34],
      [1.46, 1.02, -2.33],
      [1.68, 1.12, -2.34],
      [1.88, 1.3, -2.35],
    ];
    for (const [x, y, z] of bulbs) {
      const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
      bulb.position.set(x, y, z);
      scene.add(bulb);
    }
    const wireCurve = new THREE.CatmullRomCurve3(
      bulbs.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    const wireGeometry = new THREE.TubeGeometry(wireCurve, 60, 0.0025, 4, false);
    add(wireGeometry, stemMaterial, 0, 0, 0, scene, false);

    // ---------------------------------------------------------------- plinth ---
    const plinthGeometry = new RoundedBoxGeometry(0.4, 0.52, 0.4, 3, 0.012);
    const plinth = add(plinthGeometry, plasterMaterial, -1.2, 0.26, -1.25);
    plinth.castShadow = true;
    addContactShadow(scene, contactTexture, -1.2, 0.005, -1.25, 0.85, 0.85, 0.3);
    const smallVaseProfile: Array<[number, number]> = [
      [0, 0],
      [0.06, 0],
      [0.085, 0.02],
      [0.09, 0.07],
      [0.07, 0.12],
      [0.055, 0.15],
      [0.06, 0.19],
      [0.052, 0.2],
    ];
    const smallVaseGeometry = ceramicGeometry(smallVaseProfile);
    add(smallVaseGeometry, stonewareMaterial, -1.2, 0.525, -1.25);

    // ---------------------------------------------------------------- frame ---
    const frameGroup = new THREE.Group();
    frameGroup.position.set(0.78, 1.72, -2.56);
    scene.add(frameGroup);
    const frameOuter = new THREE.Mesh(
      new RoundedBoxGeometry(0.62, 0.82, 0.035, 3, 0.008),
      darkWoodMaterial,
    );
    frameOuter.castShadow = true;
    frameOuter.receiveShadow = true;
    frameGroup.add(frameOuter);
    geometries.add(frameOuter.geometry);
    const matBoard = new THREE.Mesh(new RoundedBoxGeometry(0.54, 0.74, 0.02, 2, 0.004), paperMaterial);
    matBoard.position.z = 0.014;
    frameGroup.add(matBoard);
    geometries.add(matBoard.geometry);
    const print = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.56), artworkMaterial);
    print.position.z = 0.028;
    print.receiveShadow = true;
    frameGroup.add(print);
    geometries.add(print.geometry);

    // -------------------------------------------------------- foreground set ---
    const grassGeometries: THREE.BufferGeometry[] = [];
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.012, 0);
    bladeShape.quadraticCurveTo(0.016, 0.45, 0.004, 1);
    bladeShape.quadraticCurveTo(-0.018, 0.45, -0.012, 0);
    const bladeBase = new THREE.ShapeGeometry(bladeShape, 6);
    const bladeCluster = (
      origin: THREE.Vector3,
      count: number,
      height: number,
      spread: number,
      seed: number,
    ) => {
      const rand = seededRandom(seed);
      for (let i = 0; i < count; i++) {
        const blade = bladeBase.clone();
        const hue = 0.095 + rand() * 0.045;
        const color = new THREE.Color().setHSL(hue, 0.28, 0.14 + rand() * 0.08);
        const colors = new Float32Array(blade.attributes.position.count * 3);
        for (let v = 0; v < blade.attributes.position.count; v++) {
          colors[v * 3] = color.r;
          colors[v * 3 + 1] = color.g;
          colors[v * 3 + 2] = color.b;
        }
        blade.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const angle = rand() * Math.PI * 2;
        const lean = spread * (0.3 + rand() * 0.7);
        const matrix = new THREE.Matrix4();
        matrix.compose(
          origin
            .clone()
            .add(new THREE.Vector3((rand() - 0.5) * 0.16, 0, (rand() - 0.5) * 0.16)),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.cos(angle) * lean,
              rand() * Math.PI,
              Math.sin(angle) * lean,
            ),
          ),
          new THREE.Vector3(0.65 + rand() * 0.35, height * (0.6 + rand() * 0.6), 1),
        );
        blade.applyMatrix4(matrix);
        grassGeometries.push(blade);
      }
    };
    bladeCluster(new THREE.Vector3(-0.8, 0, 1.02), 11, 1.55, 0.24, 5521);
    bladeCluster(new THREE.Vector3(0.8, 0, 1.05), 8, 1.2, 0.2, 8837);
    const mergedGrass = mergeGeometries(grassGeometries, false);
    grassGeometries.forEach((item) => item.dispose());
    bladeBase.dispose();
    if (mergedGrass) {
      const grass = new THREE.Mesh(mergedGrass, grassMaterial);
      grass.castShadow = true;
      grass.receiveShadow = true;
      scene.add(grass);
      geometries.add(mergedGrass);
    }

    const blossomMaterial = material({ color: '#fffaf0', roughness: 0.75, vertexColors: true, side: THREE.DoubleSide });
    const flowers = new THREE.InstancedMesh(blossomGeometry(), blossomMaterial, blossomPoints.length);
    flowers.name = 'white-flowering-branches';
    const flowerTransform = new THREE.Object3D();
    blossomPoints.forEach((point, index) => {
      flowerTransform.position.copy(point);
      flowerTransform.rotation.set(random() * 6.28, random() * 6.28, random() * 6.28);
      flowerTransform.scale.setScalar(0.005 + random() * 0.003);
      flowerTransform.updateMatrix();
      flowers.setMatrixAt(index, flowerTransform.matrix);
    });
    flowers.castShadow = flowers.receiveShadow = true;
    scene.add(flowers);

    // Architectural setting: a recessed timber window and a gathered linen curtain.
    const model = createModeling(scene);
    const windowGroup = new THREE.Group();
    windowGroup.name = 'atelier-window';
    windowGroup.position.set(-1.40, 1.78, -2.53);
    scene.add(windowGroup);
    const window = createModeling(windowGroup);
    const daylight = new THREE.MeshPhysicalMaterial({ color: '#f5fbff', transmission: 1, thickness: 0.004, ior: 1.5, roughness: 0.04, depthWrite: false, side: THREE.DoubleSide });
    materials.add(daylight);
    for (const x of [-0.55, 0.55]) window.box(darkWoodMaterial, [x, 0, 0], [0.06, 1.70, 0.07], 0.008);
    for (const y of [-0.82, 0.82]) window.box(darkWoodMaterial, [0, y, 0], [1.13, 0.06, 0.07], 0.008);
    const glazing = window.mesh(new THREE.PlaneGeometry(1.04, 1.61), daylight, [0, 0, 0.043]);
    glazing.name = 'atelier-window-glass';
    glazing.userData.pathTracingShadowTransparent = true;
    glazing.castShadow = false;
    glazing.raycast = () => {};
    for (const x of [-0.49, 0, 0.49]) window.box(darkWoodMaterial, [x, 0, 0.065], [0.025, 1.55, 0.03], 0.003);
    for (const y of [-0.76, 0, 0.76]) window.box(darkWoodMaterial, [0, y, 0.065], [1, 0.025, 0.03], 0.003);
    window.box(woodMaterial, [0, -0.86, 0.08], [1.23, 0.055, 0.25], 0.012);
    const curtainGeometry = new THREE.PlaneGeometry(0.54, 2.55, 48, 60);
    const curtainPositions = curtainGeometry.attributes.position;
    for (let i = 0; i < curtainPositions.count; i++) {
      const x = curtainPositions.getX(i), y = curtainPositions.getY(i);
      curtainPositions.setZ(i, Math.sin(x * 58) * (0.025 + (1.3 - y) * 0.008));
      curtainPositions.setX(i, x + Math.sin(y * 1.5) * 0.06);
    }
    curtainGeometry.computeVertexNormals();
    model.mesh(curtainGeometry, linenMaterial, [-2.05, 1.29, -2.34]);
    // A simple skirting board gives the room a grounded, architectural scale.
    model.box(plasterMaterial, [0, 0.09, -2.52], [8.5, 0.18, 0.05], 0.008);
    model.box(darkWoodMaterial, [0, 0.017, -2.47], [8.5, 0.025, 0.035], 0.004);

    // A hollow cup, saucer, tea surface and fine handle replace solid primitive props.
    const cupPosition = new THREE.Vector3(0.05, TABLE_TOP + 0.012, 0.50);
    const saucer = ceramicGeometry([[0, 0], [0.07, 0], [0.105, 0.012], [0.11, 0.022], [0.105, 0.026], [0.06, 0.015], [0, 0.015]]);
    model.mesh(saucer, ashMaterial, [cupPosition.x, cupPosition.y, cupPosition.z]);
    const cup = ceramicGeometry([[0, 0], [0.043, 0], [0.049, 0.008], [0.056, 0.066],
      [0.063, 0.088], [0.06, 0.091], [0.054, 0.083], [0.043, 0.018], [0, 0.018]]);
    model.mesh(cup, tealMaterial, [cupPosition.x, cupPosition.y + 0.018, cupPosition.z]);
    model.tube(tealMaterial, [[0.109, TABLE_TOP + 0.108, 0.50], [0.14, TABLE_TOP + 0.10, 0.50],
      [0.142, TABLE_TOP + 0.065, 0.50], [0.103, TABLE_TOP + 0.046, 0.50]], 0.005);
    const tea = material({ color: '#3e2414', roughness: 0.16, metalness: 0.1 });
    model.mesh(new THREE.CircleGeometry(0.053, 64).rotateX(-Math.PI / 2), tea, [0.05, TABLE_TOP + 0.098, 0.50]);
    model.tube(brassMaterial, [[0.18, TABLE_TOP + 0.016, 0.43], [0.22, TABLE_TOP + 0.018, 0.50],
      [0.26, TABLE_TOP + 0.019, 0.56]], 0.0025);
    model.ellipsoid(brassMaterial, [0.26, TABLE_TOP + 0.019, 0.56], [0.014, 0.002, 0.023], 24).rotation.y = -0.5;
    // Page signatures and spine bands give the books readable edge detail at close focus.
    bookGroup.children.forEach((book, index) => {
      const details = createModeling(book);
      const [width, height, depth] = bookSpecs[index];
      for (let i = 1; i < 7; i++) {
        details.box(paperMaterial, [0, height * (0.16 + i * 0.10), depth * 0.485],
          [width * 0.92, 0.0008, 0.001], 0.0002);
      }
      for (const z of [-depth * 0.3, depth * 0.3]) {
        details.box(brassMaterial, [-width * 0.505, height * 0.5, z], [0.0015, height * 0.68, 0.006], 0.0005);
      }
    });

    // -------------------------------------------------------------- lights ---
    scene.add(new THREE.HemisphereLight('#e6eef5', '#6a5842', 0.6));

    const key = new THREE.DirectionalLight('#fff0d7', 4.5);
    key.name = 'atelier-afternoon-sunlight';
    key.position.set(-3.4, 4.4, -7);
    key.target.position.set(-0.15, 0.95, -0.1);
    positionAfternoonSun(key, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.6;
    key.shadow.camera.far = 32;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.003;
    key.shadow.radius = 1.5;
    scene.add(key, key.target);

    const solarModel = addVisibleSun(scene, key, 48);
    // The canopy touches the ceiling's underside at y = 3.60 m.
    const beam = addPendantLamp(scene, [-0.8, 3.6, -1.0], 1.4);
    return {
      scene, sky,
      sunlight: { sun: key, model: solarModel, beam, density: 0.018, distance: 15, groundHeight: 0, heightFalloff: 0.16 },
      dispose() {
        disposeScene(scene);
        sky.dispose();
      },
    };
  },
};
