import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createModeling, type Point } from './modeling';
import { createSurface, fbm2D } from './textures';
import { anatomicalHead } from './anatomicalHead';
import { organicGeometry } from './organicGeometry';
import { addPortraitHair } from './portraitHair';

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

/** Continuous upper/lower anatomy, including the elbow or kneecap transition. */
function anatomy(parent: THREE.Object3D, points: THREE.Vector3[], radii: Array<[number, number]>, material: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(organicGeometry(points.map(p => p.toArray()), radii), material);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

function articulatedHand(parent: THREE.Object3D, wrist: THREE.Vector3, direction: THREE.Vector3,
  skin: THREE.Material, nails: THREE.Material, raised: boolean) {
  const hand = new THREE.Group(); hand.name = raised ? 'raised-articulated-hand' : 'resting-articulated-hand';
  hand.position.copy(wrist); hand.quaternion.setFromUnitVectors(V(0, 1, 0), direction);
  parent.add(hand);
  const model = createModeling(hand);
  // The palm broadens into the knuckles and narrows smoothly into the wrist.
  anatomy(hand, [V(0, -0.014, 0), V(0, 0.016, 0), V(0, 0.041, 0.001), V(0, 0.055, 0.002)],
    [[0.015, 0.016], [0.020, 0.0115], [0.024, 0.010], [0.019, 0.008]], skin, 'sculpted-palm');
  const lengths = [0.045, 0.052, 0.048, 0.037];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.0115, length = lengths[i];
    const y = 0.043 - Math.abs(i - 1.2) * 0.003;
    const curl = raised ? 0.006 + i * 0.001 : 0.015 + i * 0.001;
    anatomy(hand, [V(x, y, 0), V(x * 1.06, y + length * 0.42, -curl * 0.2),
      V(x * 1.08, y + length * 0.78, -curl * 0.65), V(x * 1.07, y + length, -curl)],
    [[0.0053, 0.0051], [0.0049, 0.0047], [0.0042, 0.004], [0.0009, 0.0011]], skin, `finger-${i}`);
    const nail = model.ellipsoid(nails, [x * 1.075, y + length * 0.86, -curl * 0.72 + 0.0034], [0.0031, 0.0052, 0.00065], 12);
    nail.rotation.x = -0.25;
  }
  anatomy(hand, [V(-0.015, 0.012, 0), V(-0.031, 0.025, 0.003), V(-0.035, 0.041, -0.001), V(-0.031, 0.051, -0.006)],
    [[0.009, 0.009], [0.007, 0.006], [0.005, 0.0045], [0.001, 0.001]], skin, 'opposed-thumb');
  model.ellipsoid(nails, [-0.032, 0.044, 0.0028], [0.0035, 0.0048, 0.0006], 12);
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
  const skin = new THREE.MeshPhysicalMaterial({ ...pores, color: '#f0cbb2', roughness: 0.53,
    normalScale: new THREE.Vector2(0.09, 0.09), sheen: 0.18, sheenColor: new THREE.Color('#e9ac98'), sheenRoughness: 0.85 });
  const faceSkin = skin.clone();
  faceSkin.color.set('#ffffff');
  faceSkin.vertexColors = true;
  const dark = new THREE.MeshStandardMaterial({ color: '#1d1614', roughness: 0.45 });
  const browMaterial = new THREE.MeshStandardMaterial({ color: '#292326', roughness: 0.6 });
  const sclera = new THREE.MeshPhysicalMaterial({ color: '#f4ede6', roughness: 0.14, clearcoat: 0.6 });
  const limbalRing = new THREE.MeshPhysicalMaterial({ color: '#1e1410', roughness: 0.25, clearcoat: 0.8 });
  const iris = new THREE.MeshPhysicalMaterial({ color: '#563a28', roughness: 0.18, clearcoat: 0.85 });
  const pupil = new THREE.MeshPhysicalMaterial({ color: '#070605', roughness: 0.04, clearcoat: 1 });
  const cornea = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.96, roughness: 0.03, ior: 1.376, clearcoat: 1.0, depthWrite: false });
  const eyeSpark = new THREE.MeshBasicMaterial({ color: '#fffdf8' });
  const eyeSparkSoft = new THREE.MeshBasicMaterial({ color: '#d2e4f0', transparent: true, opacity: 0.65 });
  const caruncle = new THREE.MeshStandardMaterial({ color: '#dc9089', roughness: 0.45 });
  const lipMaterial = new THREE.MeshPhysicalMaterial({ color: '#bb776f', roughness: 0.46, clearcoat: 0.16, clearcoatRoughness: 0.4 });
  const nails = new THREE.MeshPhysicalMaterial({ color: '#e5b8aa', roughness: 0.38, clearcoat: 0.3 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: '#7d4542', roughness: 0.6 });
  const goldBrooch = new THREE.MeshPhysicalMaterial({ color: '#dcae44', metalness: 0.9, roughness: 0.22, clearcoat: 0.5 });

  // -------------------------------------------------------------- fabrics ---
  const cotton = createSurface({ size: 192, repeat: [8, 12], normalStrength: 0.55,
    height: (u, v) => 0.5 + Math.sin(u * Math.PI * 48) * 0.2 + Math.sin(v * Math.PI * 48) * 0.2,
    color: (_u, _v, h) => [0.95 + h * 0.04, 0.945 + h * 0.04, 0.925 + h * 0.04],
  });
  const blouse = new THREE.MeshPhysicalMaterial({ ...cotton, color: '#fbfaf4', roughness: 0.86,
    normalScale: new THREE.Vector2(0.12, 0.12), sheen: 0.35, sheenRoughness: 0.92, side: THREE.DoubleSide });
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
  const sockSurface = createSurface({ size: 128, repeat: [5, 9], normalStrength: 0.6,
    height: (u, v) => 0.5 + Math.sin(u * Math.PI * 48) * 0.25 + Math.sin(v * Math.PI * 48) * 0.25,
    color: (_u, _v, h) => [0.94 + h * 0.04, 0.93 + h * 0.04, 0.90 + h * 0.04],
  });
  const sock = new THREE.MeshPhysicalMaterial({ ...sockSurface, color: '#f7f5ee', roughness: 0.9,
    normalScale: new THREE.Vector2(0.18, 0.18), side: THREE.DoubleSide });
  const leather = new THREE.MeshPhysicalMaterial({ color: '#2a1d17', roughness: 0.52, clearcoat: 0.18,
    clearcoatRoughness: 0.46 });
  const sole = new THREE.MeshStandardMaterial({ color: '#171210', roughness: 0.75 });

  // ---------------------------------------------------------------- torso ---
  const torso = new THREE.Group();
  torso.rotation.y = -0.06;
  actor.add(torso);
  const upper = createModeling(torso);
  upper.mesh(garment([[0.985, 0.121, 0.079], [1.045, 0.114, 0.078], [1.12, 0.112, 0.079],
    [1.21, 0.133, 0.094], [1.29, 0.151, 0.098], [1.35, 0.151, 0.080],
    [1.391, 0.119, 0.059], [1.425, 0.047, 0.041]], 10), blouse).name = 'tailored-continuous-torso';
  upper.mesh(garment([[1.395, 0.100, 0.049], [1.425, 0.056, 0.040], [1.450, 0.035, 0.034]], 0), skin);
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
  for (const side of [-1, 1]) upper.ellipsoid(blouse, [side * 0.128, 1.359, 0.002], [0.061, 0.047, 0.060], 28);

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
  const brooch = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 16), goldBrooch);
  brooch.position.set(0, 0, 0.008);
  brooch.rotation.x = Math.PI / 2;
  bow.add(brooch);
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
    const thigh = leg.hip.clone().lerp(leg.knee, 0.36).add(V(leg.side * 0.005, 0, -0.004));
    const calf = leg.knee.clone().lerp(leg.ankle, 0.38).add(V(leg.side * 0.004, 0, -0.009));
    anatomy(actor, [leg.hip, thigh, leg.knee, calf, leg.ankle],
      [[0.072, 0.073], [0.068, 0.071], [0.039, 0.043], [0.045, 0.049], [0.023, 0.028]], skin, 'continuous-anatomical-leg');
    // Knee-high sock, with the cuff turned over just below the knee.
    const sockTop = leg.knee.clone().lerp(leg.ankle, 0.05);
    const sockAnkle = leg.ankle.clone().add(V(0, -0.039, 0.006));
    anatomy(actor, [sockTop, calf, leg.ankle, sockAnkle],
      [[0.041, 0.044], [0.047, 0.051], [0.025, 0.030], [0.026, 0.031]], sock, 'fitted-calf-sock');
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.044, 0.018, 36), sock);
    cuff.position.copy(sockTop);
    const axis = sockTop.clone().sub(leg.ankle).normalize();
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
    cuff.castShadow = true;
    actor.add(cuff);
    for (const offset of [0.022, 0.038]) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.0445, 0.003, 32), navyDark);
      stripe.position.copy(sockTop).addScaledVector(axis, -offset);
      stripe.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
      actor.add(stripe);
    }
    // Loafer: rounded upper, dark sole and a small vamp strap.
    const footAngle = leg.side < 0 ? -0.15 : 0.2;
    const shoeGeometry = new THREE.SphereGeometry(1, 40, 24);
    const sp = shoeGeometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i), z = sp.getZ(i);
      sp.setY(i, Math.max(-0.65, y * (z > 0 ? 1 - z * 0.35 : 1)));
    }
    shoeGeometry.computeVertexNormals();
    const shoe = new THREE.Mesh(shoeGeometry, leather);
    shoe.scale.set(0.040, 0.035, 0.090);
    shoe.position.set(leg.ankle.x + leg.side * -0.004, 0.035, leg.ankle.z + 0.043);
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
    const bicep = arm.shoulder.clone().lerp(arm.elbow, 0.48);
    const forearm = arm.elbow.clone().lerp(arm.wrist, 0.34);
    anatomy(actor, [arm.shoulder, bicep, arm.elbow, forearm, arm.wrist],
      [[0.035, 0.036], [0.033, 0.035], [0.025, 0.026], [0.027, 0.028], [0.016, 0.018]], skin, 'continuous-anatomical-arm');
    // Puffed short sleeve ending above the elbow, with a small cuff.
    const sleeveEnd = arm.shoulder.clone().lerp(arm.elbow, 0.46);
    const sleeveRoot = arm.shoulder.clone().lerp(arm.elbow, -0.10);
    anatomy(actor, [sleeveRoot, arm.shoulder.clone().lerp(sleeveEnd, 0.42), sleeveEnd],
      [[0.047, 0.055], [0.060, 0.060], [0.047, 0.049]], blouse, 'soft-tailored-sleeve');
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.049, 0.010, 32), blouse);
    cuff.position.copy(sleeveEnd);
    const sleeveAxis = arm.elbow.clone().sub(arm.shoulder).normalize();
    cuff.quaternion.setFromUnitVectors(V(0, 1, 0), sleeveAxis);
    actor.add(cuff);
    articulatedHand(actor, arm.wrist, arm.hand.clone().sub(arm.wrist).normalize(), skin, nails, arm.wrist.y > 1.3);
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
    face.ellipsoid(sclera, [side * 0.031, 0.019, 0.0615], [0.016, 0.0064, 0.0100], 40);
    face.ellipsoid(limbalRing, [side * 0.031 + 0.0005, 0.019, 0.0710], [0.0057, 0.0057, 0.0014], 32);
    face.ellipsoid(iris, [side * 0.031 + 0.0005, 0.019, 0.0713], [0.0053, 0.0053, 0.0014], 32);
    face.ellipsoid(pupil, [side * 0.031 + 0.0005, 0.019, 0.0723], [0.0023, 0.0025, 0.0008], 24);
    face.ellipsoid(cornea, [side * 0.031 + 0.0005, 0.019, 0.0720], [0.0056, 0.0056, 0.0018], 28);
    face.ellipsoid(caruncle, [side * 0.0175, 0.0185, 0.0655], [0.0016, 0.0018, 0.0018], 12);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 10, 8), eyeSpark);
    spark.position.set(side * 0.031 + 0.0024, 0.0212, 0.0736);
    head.add(spark);
    const spark2 = new THREE.Mesh(new THREE.SphereGeometry(0.00065, 8, 6), eyeSparkSoft);
    spark2.position.set(side * 0.031 - 0.0019, 0.0171, 0.0734);
    head.add(spark2);
    const upper: Point[] = [], lower: Point[] = [], brow: Point[] = [], wing: Point[] = [], aegyoSal: Point[] = [], crease: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = side * 0.031 + (t - 0.5) * 0.033;
      const tilt = side * (t - 0.5) * 0.002;
      upper.push([x, 0.019 + Math.sin(t * Math.PI) * 0.0054 + tilt, 0.0602 + Math.sin(t * Math.PI) * 0.0122]);
      lower.push([x, 0.019 - Math.sin(t * Math.PI) * 0.004 + tilt, 0.0602 + Math.sin(t * Math.PI) * 0.0112]);
      aegyoSal.push([x, 0.0136 - Math.sin(t * Math.PI) * 0.0030 + tilt, 0.0612 + Math.sin(t * Math.PI) * 0.0094]);
      crease.push([x, 0.0268 + Math.sin(t * Math.PI) * 0.0038 + tilt, 0.0618 + Math.sin(t * Math.PI) * 0.0096]);
      brow.push([x, 0.0425 + Math.sin(t * Math.PI) * 0.0034, 0.0655 - Math.abs(t - 0.5) * 0.012]);
      if (i >= 17) wing.push([side * (0.031 + 0.015 + (i - 17) * 0.0022), 0.0218 + (i - 17) * 0.0019,
        0.0602 + Math.sin(t * Math.PI) * 0.0122]);
    }
    for (const lid of [-1, 1]) {
      const patch = sheetGeometry(10, 40, (u, v) => {
        const arch = Math.sin(u * Math.PI), x = side * 0.031 + (u - 0.5) * 0.033;
        return V(x, 0.019 + lid * arch * ((lid > 0 ? 0.0054 : 0.004) + v * 0.009)
          + side * (u - 0.5) * 0.002, 0.0602 + arch * (0.0122 - v * 0.009));
      });
      const eyelid = skin.clone(); eyelid.side = THREE.DoubleSide;
      face.mesh(patch, eyelid).name = 'blended-anatomical-eyelid';
    }
    face.tube(skin, upper, 0.0009, 28);
    face.tube(skin, lower, 0.00065, 28);
    // Lash line: thicker than the lid, with a small outer wing.
    face.tube(dark, upper.map(([x, y, z]) => [x, y - 0.0003, z + 0.0005]), 0.0005, 28);
    face.tube(dark, wing, 0.00035, 12);
    face.tube(browMaterial, brow, 0.0013, 28);
    // Soft ear contours beneath side locks
    const earHelix: Point[] = [
      [side * 0.070, 0.036, -0.016],
      [side * 0.079, 0.028, -0.010],
      [side * 0.081, 0.012, -0.005],
      [side * 0.077, -0.006, -0.004],
      [side * 0.071, -0.016, -0.005],
    ];
    face.tube(skin, earHelix, 0.0028, 16);
    face.ellipsoid(skin, [side * 0.073, -0.015, -0.005], [0.004, 0.0055, 0.0035], 14);
  }

  // Cupid's bow and lower vermilion blend into the face at the mouth corners.
  lipMaterial.side = THREE.DoubleSide;
  for (const side of [-1, 1]) {
    face.mesh(sheetGeometry(12, 40, (u, v) => {
      const x = u * 2 - 1, fullness = Math.pow(Math.max(0, 1 - x * x), 0.7);
      const bow = side > 0 ? 0.0034 + 0.0015 * Math.exp(-(((Math.abs(x) - 0.3) / 0.22) ** 2)) : 0.0045;
      return V(x * 0.017, -0.0435 + x * x * 0.0012 + side * v * bow * fullness,
        0.0715 + fullness * (0.004 + Math.sin(v * Math.PI) * 0.0012 - v * 0.0015));
    }), lipMaterial).name = 'sculpted-lip';
  }
  face.tube(mouthMaterial, Array.from({ length: 25 }, (_, i): Point => {
    const t = i / 12 - 1;
    return [t * 0.016, -0.0435 + t * t * 0.0012, 0.0716 + (1 - t * t) * 0.0041];
  }), 0.0003, 28);

  // Hair remains real, closed geometry in both raster and path-traced views.
  addPortraitHair(head, headGeometry);

  head.updateMatrixWorld(true);
  const eyePoint = head.localToWorld(V(-0.0305, 0.019, 0.0735));
  return { actor, eyePoint };
}
