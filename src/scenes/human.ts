import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createModeling, type Point } from './modeling';
import { createSurface, fbm2D } from './textures';
import { anatomicalHead } from './anatomicalHead';

type Vec = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Elliptical garment with a continuous silhouette and small sewn folds. */
function garment(profile: Array<[number, number, number]>, folds: number, depthOffset = 0) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const ringSegments = 96, rows = 80;
  const width = new THREE.SplineCurve(profile.map(([y, w]) => new THREE.Vector2(y, w)));
  const depth = new THREE.SplineCurve(profile.map(([y, _w, d]) => new THREE.Vector2(y, d)));
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, p = width.getPoint(t), d = depth.getPoint(t).y;
    for (let j = 0; j <= ringSegments; j++) {
      const a = j / ringSegments * Math.PI * 2;
      const fold = 1 + Math.sin(a * folds + t * 1.5) * 0.012;
      positions.push(Math.cos(a) * p.y * fold, p.x, Math.sin(a) * d * fold + depthOffset);
      uvs.push(j / ringSegments, t);
      if (row < rows && j < ringSegments) {
        const v = row * (ringSegments + 1) + j;
        indices.push(v, v + ringSegments + 1, v + 1, v + 1, v + ringSegments + 1, v + ringSegments + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cylindrical pleated skirt with a soft flare; the hem stays open under the camera. */
function pleatedSkirt(topY: number, bottomY: number, topR: number, bottomR: number, depth: number, pleats: number) {
  const rows = 12, segments = 144;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const y = THREE.MathUtils.lerp(topY, bottomY, t);
    const radius = THREE.MathUtils.lerp(topR, bottomR, Math.pow(t, 0.92));
    for (let s = 0; s <= segments; s++) {
      const a = s / segments * Math.PI * 2;
      const pleat = 1 + Math.sin(a * pleats) * 0.045 * (0.35 + t * 0.65);
      positions.push(Math.cos(a) * radius * pleat, y, Math.sin(a) * radius * depth * pleat);
      uvs.push(s / segments, t);
      if (row < rows && s < segments) {
        const v = row * (segments + 1) + s;
        indices.push(v, v + 1, v + segments + 1, v + 1, v + segments + 2, v + segments + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Tapered limb segment between two joints. */
function limb(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, r1: number, r2: number, material: THREE.Material) {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const profile = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    const radius = THREE.MathUtils.lerp(r1, r2, t) * (0.92 + 0.13 * Math.sin(Math.PI * t));
    return new THREE.Vector2(radius, (t - 0.5) * length);
  });
  const geometry = new THREE.LatheGeometry(profile, 28);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), direction.normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Cupped hair lock: three columns give the strip real cross-section volume. */
function hairLock(parent: THREE.Object3D, points: Vec[], widths: number[], material: THREE.Material, bulge = 0.007) {
  const cols = 3, rows = points.length;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const up = V(0, 0, 1);
  const vectors = points.map((p) => V(...p));
  for (let i = 0; i < rows; i++) {
    const prev = vectors[Math.max(0, i - 1)], next = vectors[Math.min(rows - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, up);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const p = vectors[i].clone().addScaledVector(side, (u * 2 - 1) * widths[i]);
      p.z += Math.sin(u * Math.PI) * bulge;
      positions.push(p.x, p.y, p.z);
      uvs.push(u, i / (rows - 1));
    }
    if (i < rows - 1) for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Broad hair curtain with a wavy inner edge and a rounded cross-section. */
function hairCurtain(parent: THREE.Object3D, points: Vec[], widths: number[], material: THREE.Material, bulge = 0.011) {
  const cols = 5, rows = points.length;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const up = V(0, 0, 1);
  const vectors = points.map((p) => V(...p));
  for (let i = 0; i < rows; i++) {
    const prev = vectors[Math.max(0, i - 1)], next = vectors[Math.min(rows - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, up);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const wave = 1;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const p = vectors[i].clone().addScaledVector(side, (u * 2 - 1) * widths[i] * wave);
      p.z += Math.sin(u * Math.PI) * bulge;
      positions.push(p.x, p.y, p.z);
      uvs.push(u, i / (rows - 1));
    }
    if (i < rows - 1) for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Parametric sheet used for the long straight back hair and the fringe. */
function sheetGeometry(rows: number, cols: number, point: (u: number, v: number) => THREE.Vector3) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const u = col / cols, v = row / rows;
      const p = point(u, v);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
      if (row < rows && col < cols) {
        const a = row * (cols + 1) + col;
        indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPortraitModel() {
  const actor = new THREE.Group();
  actor.name = 'outdoor-portrait-model';
  const model = createModeling(actor);

  // ---------------------------------------------------------------- skin ---
  const pores = createSurface({ size: 256, normalStrength: 0.3,
    height: (u, v) => fbm2D(u, v, 110, 110, 82) * 0.6 + fbm2D(u, v, 24, 24, 91) * 0.1,
    color: (_u, _v, h) => [0.96 + h * 0.025, 0.96 + h * 0.022, 0.96 + h * 0.02],
  });
  const skin = new THREE.MeshPhysicalMaterial({ ...pores, color: '#eec5a8', roughness: 0.48,
    normalScale: new THREE.Vector2(0.07, 0.07), sheen: 0.2, sheenColor: new THREE.Color('#e8a289'), sheenRoughness: 0.8 });
  const faceSkin = skin.clone();
  faceSkin.color.set('#ffffff');
  faceSkin.vertexColors = true;
  const dark = new THREE.MeshStandardMaterial({ color: '#1d1614', roughness: 0.45 });
  const browMaterial = new THREE.MeshStandardMaterial({ color: '#292326', roughness: 0.6 });
  const sclera = new THREE.MeshPhysicalMaterial({ color: '#f1ebe4', roughness: 0.16, clearcoat: 0.6 });
  const iris = new THREE.MeshPhysicalMaterial({ color: '#4a3428', roughness: 0.2, clearcoat: 0.8 });
  const pupil = new THREE.MeshPhysicalMaterial({ color: '#0d0b0a', roughness: 0.05, clearcoat: 1 });
  const eyeSpark = new THREE.MeshBasicMaterial({ color: '#f4ece0' });
  const lipMaterial = new THREE.MeshPhysicalMaterial({ color: '#b0746c', roughness: 0.4, clearcoat: 0.35 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: '#7d4c48', roughness: 0.6 });

  // -------------------------------------------------------------- fabrics ---
  const cotton = createSurface({ size: 192, repeat: [30, 40], normalStrength: 1.1,
    height: (u, v) => 0.5 + Math.sin(u * 210) * 0.2 + Math.sin(v * 210) * 0.2,
    color: (_u, _v, h) => [0.95 + h * 0.04, 0.945 + h * 0.04, 0.925 + h * 0.04],
  });
  const blouse = new THREE.MeshPhysicalMaterial({ ...cotton, color: '#fbfaf4', roughness: 0.86,
    normalScale: new THREE.Vector2(0.2, 0.2), sheen: 0.5, sheenRoughness: 0.92, side: THREE.DoubleSide });
  const twill = createSurface({ size: 192, repeat: [16, 8], normalStrength: 1.4,
    height: (u, v) => 0.5 + Math.sin((u * 26 + v * 8) * Math.PI) * 0.35,
    color: (_u, _v, h) => [0.085 + h * 0.03, 0.10 + h * 0.035, 0.17 + h * 0.05],
  });
  const navy = new THREE.MeshPhysicalMaterial({ ...twill, color: '#f2f4ff', roughness: 0.86,
    normalScale: new THREE.Vector2(0.22, 0.22), sheen: 0.35, sheenRoughness: 0.9, side: THREE.DoubleSide });
  const navyDark = new THREE.MeshPhysicalMaterial({ ...twill, color: '#d9dbea', roughness: 0.9,
    normalScale: new THREE.Vector2(0.22, 0.22), side: THREE.DoubleSide });
  const stripe = new THREE.MeshStandardMaterial({ color: '#f7f6ee', roughness: 0.7 });
  const red = new THREE.MeshPhysicalMaterial({ color: '#ab2e39', roughness: 0.42, clearcoat: 0.3, side: THREE.DoubleSide });
  const sockSurface = createSurface({ size: 128, repeat: [8, 14], normalStrength: 1.0,
    height: (u, v) => 0.5 + Math.sin(u * 160) * 0.25 + Math.sin(v * 160) * 0.25,
    color: (_u, _v, h) => [0.94 + h * 0.04, 0.93 + h * 0.04, 0.90 + h * 0.04],
  });
  const sock = new THREE.MeshPhysicalMaterial({ ...sockSurface, color: '#f7f5ee', roughness: 0.9,
    normalScale: new THREE.Vector2(0.18, 0.18), side: THREE.DoubleSide });
  const leather = new THREE.MeshPhysicalMaterial({ color: '#2a1d17', roughness: 0.36, clearcoat: 0.55,
    clearcoatRoughness: 0.32 });
  const sole = new THREE.MeshStandardMaterial({ color: '#171210', roughness: 0.75 });

  // ---------------------------------------------------------------- torso ---
  const torso = new THREE.Group();
  torso.rotation.y = -0.06;
  actor.add(torso);
  const upper = createModeling(torso);
  upper.mesh(garment([[0.985, 0.108, 0.073], [1.10, 0.104, 0.080], [1.20, 0.125, 0.091],
    [1.29, 0.150, 0.095], [1.37, 0.136, 0.079], [1.43, 0.070, 0.058]], 12), blouse);
  // Tailored sailor collar: two continuous lapels lying against the blouse.
  for (const side of [-1, 1]) {
    const patch = sheetGeometry(18, 12, (u, v) => {
      const inner = V(side * 0.044 * (1 - v), 1.435 - v * 0.142, 0.055 + v * 0.051);
      const outer = V(side * (0.164 * (1 - v) + 0.012 * v), 1.379 - v * 0.086, 0.062 + v * 0.044);
      return inner.lerp(outer, u);
    });
    upper.mesh(patch, navy).name = 'sailor-lapel';
    for (const inset of [0.72, 0.88]) {
      const trim: Point[] = [];
      for (let i = 0; i <= 18; i++) {
        const v = i / 18;
        const inner = V(side * 0.044 * (1 - v), 1.435 - v * 0.142, 0.058 + v * 0.051);
        const outer = V(side * (0.164 * (1 - v) + 0.012 * v), 1.379 - v * 0.086, 0.065 + v * 0.044);
        trim.push(inner.lerp(outer, inset).toArray() as Point);
      }
      upper.tube(stripe, trim, 0.0015, 22);
    }
  }
  upper.box(navy, [0, 1.367, -0.083], [0.265, 0.115, 0.008], 0.004);
  // Shoulders of the blouse close the collar ring.
  for (const side of [-1, 1]) upper.ellipsoid(blouse, [side * 0.128, 1.366, 0.004], [0.078, 0.062, 0.072], 28);

  // Flat red neck ribbon with two loops, a knot and two tails.
  const bow = new THREE.Group();
  bow.position.set(0, 1.306, 0.094);
  bow.rotation.x = -0.12;
  torso.add(bow);
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), red);
    loop.position.set(side * 0.029, 0.003, 0.0);
    loop.scale.set(0.031, 0.019, 0.009);
    loop.rotation.z = side * -0.38;
    loop.castShadow = true;
    bow.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.013, 20, 14), red);
  knot.scale.set(1, 0.9, 0.7);
  bow.add(knot);
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.072, 0.006, 2, 0.0025), red);
    tail.position.set(side * 0.015, -0.048, -0.002);
    tail.rotation.z = side * 0.14;
    tail.castShadow = true;
    bow.add(tail);
  }

  // ---------------------------------------------------------------- skirt ---
  const skirt = new THREE.Mesh(pleatedSkirt(1.015, 0.675, 0.127, 0.205, 0.83, 24), navy);
  skirt.castShadow = skirt.receiveShadow = true;
  actor.add(skirt);
  const waistband = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.130, 0.05, 48), navyDark);
  waistband.position.y = 1.010;
  waistband.scale.z = 0.88;
  waistband.castShadow = waistband.receiveShadow = true;
  actor.add(waistband);

  // ----------------------------------------------------------------- legs ---
  const legJoints: Array<{ side: number; hip: THREE.Vector3; knee: THREE.Vector3; ankle: THREE.Vector3 }> = [
    { side: -1, hip: V(-0.074, 0.888, 0.0), knee: V(-0.084, 0.452, 0.012), ankle: V(-0.100, 0.082, 0.030) },
    { side: 1, hip: V(0.074, 0.888, 0.0), knee: V(0.025, 0.464, 0.100), ankle: V(0.046, 0.082, 0.207) },
  ];
  for (const leg of legJoints) {
    limb(actor, leg.hip, leg.knee, 0.068, 0.047, skin);
    model.ellipsoid(skin, [leg.knee.x, leg.knee.y, leg.knee.z], [0.047, 0.048, 0.047], 24);
    limb(actor, leg.knee, leg.ankle, 0.046, 0.028, skin);
    // Knee-high sock, with the cuff turned over just below the knee.
    const sockTop = leg.knee.clone().lerp(leg.ankle, 0.05);
    limb(actor, sockTop, leg.ankle, 0.049, 0.030, sock);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.050, 0.025, 28), sock);
    cuff.position.copy(sockTop);
    const axis = sockTop.clone().sub(leg.ankle).normalize();
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
    cuff.castShadow = true;
    actor.add(cuff);
    for (const offset of [0.022, 0.038]) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.049, 0.004, 24), navyDark);
      stripe.position.copy(sockTop).addScaledVector(axis, -offset);
      stripe.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
      actor.add(stripe);
    }
    // Loafer: rounded upper, dark sole and a small vamp strap.
    const footAngle = leg.side < 0 ? -0.15 : 0.2;
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.048, 0.17, 3, 0.015), leather);
    shoe.position.set(leg.ankle.x + leg.side * -0.004, 0.029, leg.ankle.z + 0.048);
    shoe.rotation.y = footAngle;
    shoe.castShadow = shoe.receiveShadow = true;
    actor.add(shoe);
    const soleMesh = new THREE.Mesh(new RoundedBoxGeometry(0.081, 0.017, 0.178, 2, 0.007), sole);
    soleMesh.position.set(shoe.position.x, 0.008, shoe.position.z);
    soleMesh.rotation.y = footAngle;
    soleMesh.receiveShadow = true;
    actor.add(soleMesh);
    const vamp = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.013, 0.055, 2, 0.005), sole);
    vamp.position.set(shoe.position.x, 0.052, shoe.position.z - 0.014);
    vamp.rotation.y = footAngle;
    actor.add(vamp);
  }

  // ----------------------------------------------------------------- arms ---
  const armJoints = [
    // Near arm, raised so the fingers brush the hair beside the jaw.
    { shoulder: V(-0.151, 1.358, 0.004), elbow: V(-0.268, 1.205, 0.042), wrist: V(-0.164, 1.423, 0.095), hand: V(-0.128, 1.469, 0.092) },
    // Far arm, hand resting on the hip.
    { shoulder: V(0.151, 1.358, 0.004), elbow: V(0.282, 1.186, -0.010), wrist: V(0.151, 1.057, 0.091), hand: V(0.125, 1.027, 0.108) },
  ];
  for (const arm of armJoints) {
    limb(actor, arm.shoulder, arm.elbow, 0.036, 0.028, skin);
    limb(actor, arm.elbow, arm.wrist, 0.028, 0.021, skin);
    model.ellipsoid(skin, [arm.elbow.x, arm.elbow.y, arm.elbow.z], [0.029, 0.029, 0.029], 20);
    // Puffed short sleeve ending above the elbow, with a small cuff.
    const sleeveEnd = arm.shoulder.clone().lerp(arm.elbow, 0.46);
    limb(actor, arm.shoulder, sleeveEnd, 0.069, 0.058, blouse);
    model.ellipsoid(blouse, [arm.shoulder.x, arm.shoulder.y, arm.shoulder.z], [0.073, 0.068, 0.07], 26);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.062, 0.012, 24), blouse);
    cuff.position.copy(sleeveEnd);
    const sleeveAxis = arm.elbow.clone().sub(arm.shoulder).normalize();
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), sleeveAxis);
    actor.add(cuff);
    // Palm oriented along the forearm, with four fingers and a thumb.
    const palm = arm.wrist.clone().lerp(arm.hand, 0.55);
    const handDirection = arm.hand.clone().sub(arm.wrist).normalize();
    const palmMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin);
    palmMesh.position.copy(palm);
    palmMesh.scale.set(0.021, 0.035, 0.013);
    palmMesh.quaternion.setFromUnitVectors(V(0, 1, 0), handDirection);
    palmMesh.castShadow = true;
    actor.add(palmMesh);
    const across = new THREE.Vector3().crossVectors(handDirection, V(0, 0, 1)).normalize();
    for (let finger = 0; finger < 4; finger++) {
      const lateral = (finger - 1.5) * 0.009;
      const root = palm.clone().addScaledVector(handDirection, 0.031).addScaledVector(across, lateral);
      const tip = root.clone().addScaledVector(handDirection, 0.026 + Math.abs(finger - 1) * 0.002);
      limb(actor, root, tip, 0.0045, 0.0036, skin);
    }
    const thumbRoot = palm.clone().addScaledVector(handDirection, 0.006).addScaledVector(V(0, 0, 1), 0.016);
    limb(actor, thumbRoot, thumbRoot.clone().addScaledVector(V(0, 0.8, 0.6).normalize(), 0.023), 0.0052, 0.0042, skin);
  }

  // ---------------------------------------------------------------- neck ---
  model.ellipsoid(skin, [0, 1.468, 0.004], [0.037, 0.062, 0.040]);

  // ---------------------------------------------------------------- head ---
  const head = new THREE.Group();
  head.name = 'portrait-head';
  head.position.set(0, 1.556, 0.014);
  head.rotation.set(0.015, -0.12, -0.10);
  actor.add(head);
  const face = createModeling(head);
  const headGeometry = anatomicalHead();
  face.mesh(headGeometry, faceSkin).name = 'anatomical-face';

  for (const side of [-1, 1]) {
    face.ellipsoid(sclera, [side * 0.031, 0.019, 0.0615], [0.017, 0.0083, 0.0108], 40);
    face.ellipsoid(iris, [side * 0.031 + 0.0005, 0.019, 0.0714], [0.0074, 0.0074, 0.0019], 32);
    face.ellipsoid(pupil, [side * 0.031 + 0.0005, 0.019, 0.073], [0.0031, 0.0032, 0.001], 24);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 10, 8), eyeSpark);
    spark.position.set(side * 0.031 + 0.0024, 0.0212, 0.0736);
    head.add(spark);
    const upper: Point[] = [], lower: Point[] = [], brow: Point[] = [], wing: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = side * 0.031 + (t - 0.5) * 0.033;
      const tilt = side * (t - 0.5) * 0.002;
      upper.push([x, 0.019 + Math.sin(t * Math.PI) * 0.0066 + tilt, 0.0602 + Math.sin(t * Math.PI) * 0.0122]);
      lower.push([x, 0.019 - Math.sin(t * Math.PI) * 0.004 + tilt, 0.0602 + Math.sin(t * Math.PI) * 0.0112]);
      brow.push([x, 0.0425 + Math.sin(t * Math.PI) * 0.0034, 0.0655 - Math.abs(t - 0.5) * 0.012]);
      if (i >= 17) wing.push([side * (0.031 + 0.015 + (i - 17) * 0.0022), 0.0218 + (i - 17) * 0.0019,
        0.0602 + Math.sin(t * Math.PI) * 0.0122]);
    }
    face.tube(skin, upper, 0.0017, 28);
    face.tube(skin, lower, 0.0011, 28);
    // Lash line: thicker than the lid, with a small outer wing.
    face.tube(dark, upper.map(([x, y, z]) => [x, y - 0.0006, z + 0.001]), 0.0011, 28);
    face.tube(dark, wing, 0.0008, 12);
    face.tube(browMaterial, brow, 0.0013, 28);
  }

  // Defined lips sit just proud of the anatomical surface.
  const upperLip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), lipMaterial);
  upperLip.position.set(0, -0.0385, 0.0742);
  upperLip.scale.set(0.017, 0.0052, 0.0054);
  head.add(upperLip);
  const lowerLip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), lipMaterial);
  lowerLip.position.set(0, -0.0485, 0.0748);
  lowerLip.scale.set(0.0148, 0.006, 0.006);
  head.add(lowerLip);
  const mouthLine = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.0011, 0.002), mouthMaterial);
  mouthLine.position.set(0, -0.0435, 0.0758);
  head.add(mouthLine);

  // ---------------------------------------------------------------- hair ---
  const hairSurface = createSurface({ size: 256, repeat: [1, 1], normalStrength: 2.0,
    height: (u, v) => 0.5 + Math.sin(u * Math.PI * 2 * 52 + Math.sin(v * 11) * 2) * 0.27 + fbm2D(u, v, 90, 5, 21) * 0.16,
    color: (u, v, h) => {
      const strand = 0.56 + h * 0.3 + fbm2D(u, v, 140, 8, 33) * 0.12;
      return [strand, strand * 0.955, strand * 0.925];
    },
    roughness: (_u, _v, h) => 0.24 + (1 - h) * 0.16,
  });
  const hair = new THREE.MeshPhysicalMaterial({ ...hairSurface, color: '#11131a', roughness: 0.38,
    metalness: 0, anisotropy: 0.7, anisotropyRotation: Math.PI / 2, sheen: 0.65,
    sheenColor: new THREE.Color('#434956'), sheenRoughness: 0.42, clearcoat: 0.16,
    clearcoatRoughness: 0.28, envMapIntensity: 0.7,
    normalScale: new THREE.Vector2(0.28, 0.28), side: THREE.DoubleSide });
  const hairShine = new THREE.MeshPhysicalMaterial({ color: '#343a48', roughness: 0.4,
    metalness: 0.25, clearcoat: 0.7, transparent: true, opacity: 0.12, side: THREE.DoubleSide });

  // Scalp cap follows the anatomical head, offset outwards by 3.5 mm.
  const cap = headGeometry.clone();
  const hp = cap.attributes.position, hn = cap.attributes.normal;
  const headIndices = headGeometry.index!;
  const capIndices: number[] = [];
  for (let i = 0; i < headIndices.count; i += 3) {
    const ids = [headIndices.getX(i), headIndices.getX(i + 1), headIndices.getX(i + 2)];
    if (ids.every((id) => {
      const x = hp.getX(id), y = hp.getY(id), z = hp.getZ(id);
      const boundary = -0.052 + 0.138 * THREE.MathUtils.clamp(z / 0.075, 0, 1);
      return y > boundary && (Math.abs(x) < 0.076 || y > 0.044);
    })) capIndices.push(...ids);
  }
  for (let i = 0; i < hp.count; i++) hp.setXYZ(i,
    hp.getX(i) + hn.getX(i) * 0.0035,
    hp.getY(i) + hn.getY(i) * 0.0035,
    hp.getZ(i) + hn.getZ(i) * 0.0035);
  cap.setIndex(capIndices);
  face.mesh(cap, hair).name = 'hair-cap';

  // A continuous rounded curtain wraps the back and sides; strands stop at the waist.
  // Upper rows follow the skull so the crown never exposes a gap from the rear.
  const backSheet = sheetGeometry(64, 72, (u, v) => {
    const angle = 0.12 + u * (Math.PI - 0.24);
    const drop = THREE.MathUtils.smoothstep(v, 0, 0.2);
    const width = THREE.MathUtils.lerp(0.077, 0.132, drop);
    const taper = 1 - 0.10 * THREE.MathUtils.smoothstep(v, 0.82, 1);
    const x = Math.cos(angle) * width * taper;
    const y = 0.079 - v * 0.665 + Math.pow(v, 10) * (0.012 * Math.cos(u * 32) + 0.018 * Math.abs(u * 2 - 1));
    const z = -0.015 - Math.sin(angle) * (0.063 + drop * 0.068) + drop * 0.033;
    return V(x, y, z);
  });
  face.mesh(backSheet, hair).name = 'long-straight-hair';

  // Smooth face-framing locks, sampled densely to avoid angular sheet edges.
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      V(side * 0.057, 0.101, 0.008), V(side * 0.085, 0.047, 0.033),
      V(side * 0.093, -0.045, 0.042), V(side * 0.111, -0.169, 0.079),
      V(side * 0.125, -0.325, 0.106), V(side * 0.122, -0.510, 0.110),
    ]);
    const points = curve.getPoints(48).map(p => p.toArray() as Vec);
    const widths = points.map((_, i) => {
      const t = i / 48;
      return 0.013 + Math.sin(Math.PI * t) * 0.012 - Math.pow(t, 8) * 0.010;
    });
    hairCurtain(head, points, widths, hair, 0.006);
    for (const offset of [-0.55, 0.15, 0.6]) {
      const strand = points.map(([x, y, z], i) => [x + widths[i] * offset, y, z + 0.007] as Vec);
      hairLock(head, strand, widths.map(() => 0.0006), hairShine, 0.0004);
    }
  }

  // Fringe cut just above the brows, with a soft pointed edge and a hint of a side part.
  const fringe = sheetGeometry(14, 26, (u, v) => {
    const t = u * 2 - 1;
    const part = 0.004 * Math.exp(-((t + 0.14) ** 2) / 0.02);
    const finger = 0.005 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4.6 + 0.7));
    const y = 0.090 - v * (0.045 + finger * 1.15 + part);
    const x = t * 0.083 * (1 - 0.05 * v);
    const z = 0.034 + v * 0.052 + 0.012 * (1 - t * t) + Math.sin(t * 9) * 0.0008;
    return V(x, y, z);
  });
  const fringeMesh = new THREE.Mesh(fringe, hair);
  fringeMesh.castShadow = fringeMesh.receiveShadow = true;
  head.add(fringeMesh);
  fringeMesh.name = 'straight-fringe';

  // A short wisp at each temple softens the hairline without crossing the face.
  for (const side of [-1, 1]) {
    hairLock(head, [
      [side * 0.078, 0.080, 0.030], [side * 0.084, 0.048, 0.048], [side * 0.088, 0.010, 0.044],
      [side * 0.090, -0.030, 0.032],
    ], [0.008, 0.011, 0.010, 0.006], hair, 0.004);
    hairLock(head, [
      [side * 0.081, 0.074, 0.034], [side * 0.086, 0.042, 0.050],
    ], [0.0025, 0.002], hairShine, 0.001);
  }

  head.updateMatrixWorld(true);
  const eyePoint = head.localToWorld(V(-0.0305, 0.019, 0.0735));
  return { actor, eyePoint };
}
