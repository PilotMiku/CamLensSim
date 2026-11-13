import * as THREE from 'three';
import { createModeling } from './modeling';
import { createSurface, fbm2D } from './textures';
import { seededRandom } from './helpers';
import { organicGeometry } from './organicGeometry';

/** A single lofted body and head avoids a visible ball-to-ball neck seam. */
function robinGeometry() {
  const profile = [
    [-0.145, 0.005, 0.008, 0.0], [-0.11, 0.080, 0.107, 0.01],
    [-0.04, 0.125, 0.149, 0.004], [0.035, 0.120, 0.143, 0.006],
    [0.095, 0.092, 0.103, 0.044], [0.139, 0.076, 0.075, 0.078],
    [0.178, 0.069, 0.065, 0.081], [0.211, 0.030, 0.032, 0.080], [0.219, 0.001, 0.001, 0.080],
  ];
  const rx = new THREE.SplineCurve(profile.map(([y, x]) => new THREE.Vector2(y, x)));
  const rz = new THREE.SplineCurve(profile.map(([y, _x, z]) => new THREE.Vector2(y, z)));
  const center = new THREE.SplineCurve(profile.map(([y, _x, _z, zc]) => new THREE.Vector2(y, zc)));
  const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  const rows = 120, sides = 96;
  const color = new THREE.Color(),
    brown = new THREE.Color('#716c51'),
    buff = new THREE.Color('#e1deca'),
    rust = new THREE.Color('#c96c32'),
    goldFringe = new THREE.Color('#bca387'),
    flank = new THREE.Color('#8c7f6b');
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, p = rx.getPoint(t), depth = Math.max(0.001, rz.getPoint(t).y), zc = center.getPoint(t).y;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, front = Math.sin(a);
      const x = Math.cos(a) * Math.max(0.001, p.y), z = zc + front * depth;
      positions.push(x, p.x, z);
      const belly = (1 - THREE.MathUtils.smoothstep(p.x, -0.10, 0.0)) * THREE.MathUtils.smoothstep(front, -0.45, 0.3);
      const bibCore = THREE.MathUtils.smoothstep(front + 0.025 * Math.sin(row * 2.3 + j * 1.7), -0.05, 0.55)
        * THREE.MathUtils.smoothstep(p.x, -0.065, -0.012) * (1 - THREE.MathUtils.smoothstep(p.x, 0.175, 0.205));
      const bibFringe = THREE.MathUtils.smoothstep(front, -0.18, 0.6)
        * THREE.MathUtils.smoothstep(p.x, -0.08, -0.01) * (1 - THREE.MathUtils.smoothstep(p.x, 0.18, 0.215));
      const sideFlank = (1 - Math.abs(front)) * THREE.MathUtils.smoothstep(p.x, -0.10, 0.05);

      color.copy(brown).lerp(flank, sideFlank * 0.45).lerp(buff, belly).lerp(goldFringe, bibFringe * 0.6).lerp(rust, bibCore);
      color.multiplyScalar(0.98 + Math.sin(a * 24 + p.x * 70) * 0.02);
      colors.push(color.r, color.g, color.b);
      uv.push(j / sides, t);
      if (row < rows && j < sides) {
        const v = row * (sides + 1) + j;
        indices.push(v, v + sides + 1, v + 1, v + 1, v + sides + 1, v + sides + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rounded pennaceous feather: tapered vane, raised rachis and a soft cupped tip. */
function featherGeometry() {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rows = 14, cols = 6;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const width = 0.5 * Math.pow(Math.sin(Math.PI * (0.008 + t * 0.984)), 0.65) * (1 - 0.20 * t);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols, x = u * 2 - 1;
      const rachis = Math.exp(-((x * 8.5) ** 2)) * 0.045 * (1 - 0.35 * t);
      const cup = (1 - x * x) * 0.09 * Math.sin(Math.PI * t) + t * t * 0.045;
      positions.push(x * width, t, cup + rachis);
      uvs.push(u, t);
      if (r < rows && c < cols) {
        const i = r * (cols + 1) + c;
        indices.push(i, i + 1, i + cols + 1, i + 1, i + cols + 2, i + cols + 1);
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

/** Fine, shingled contour feathers lie directly on the continuous body surface.
 * Sampling the loft prevents floating feather tips on the curved breast and neck. */
function contourPlumage(body: THREE.BufferGeometry, random: () => number) {
  const source = body.attributes.position, normals = body.attributes.normal, colors = body.attributes.color;
  const positions: number[] = [], uv: number[] = [], tints: number[] = [], surfaceNormals: number[] = [], indices: number[] = [];
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), color = new THREE.Color();
  const sample = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, row: number, column: number, out: THREE.Vector3 | THREE.Color) => {
    const r = THREE.MathUtils.clamp(row, 1, 119), c = ((column % 96) + 96) % 96;
    const r0 = Math.floor(r), c0 = Math.floor(c), fr = r - r0, fc = c - c0;
    const ids = [r0 * 97 + c0, r0 * 97 + c0 + 1, (r0 + 1) * 97 + c0, (r0 + 1) * 97 + c0 + 1];
    const weights = [(1 - fr) * (1 - fc), (1 - fr) * fc, fr * (1 - fc), fr * fc];
    const components = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      components[0] += attribute.getX(ids[i]) * weights[i];
      components[1] += attribute.getY(ids[i]) * weights[i];
      components[2] += attribute.getZ(ids[i]) * weights[i];
    }
    if (out instanceof THREE.Color) out.setRGB(...components as [number, number, number]);
    else out.set(...components as [number, number, number]);
  };
  const rows = 5, cols = 4;
  for (let r = 5; r < 116; r += 1.8) for (let c = 0; c < 96; c += 1.35) {
    const rootR = r + random() * 1.7, rootC = c + random() * 1.3;
    sample(source, rootR, rootC, point);
    if (Math.hypot(Math.abs(point.x) - 0.059, point.y - 0.171, point.z - 0.129) < 0.012) continue;
    const featherLength = point.y > 0.10 ? 1.5 : 2.8 + random() * 1.2;
    const width = 0.90 + random() * 0.32, base = positions.length / 3;
    const tone = 0.995 + random() * 0.01;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const t = i / rows, x = j / cols * 2 - 1;
      const taper = Math.pow(Math.sin(Math.PI * (0.12 + t * 0.88)), 0.65);
      const row = rootR - t * featherLength, col = rootC + x * width * taper;
      sample(source, row, col, point); sample(normals, row, col, normal); normal.normalize();
      sample(colors, row, col, color); color.multiplyScalar(tone);
      // Lift is sub-millimetre, keeping micro feathers close to the loft.
      const lift = 0.00025 + Math.sin(Math.PI * t) * 0.00008 + t * 0.00006;
      point.addScaledVector(normal, lift);
      positions.push(point.x, point.y, point.z); uv.push(j / cols, t);
      surfaceNormals.push(normal.x, normal.y, normal.z);
      const edge = 1 - Math.abs(x) * 0.008;
      tints.push(color.r * edge, color.g * edge, color.b * edge);
      if (i < rows && j < cols) {
        const a = base + i * (cols + 1) + j;
        indices.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(surfaceNormals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Local modelling units are scaled to a small, life-size perched subject. */
export function createRobin() {
  const bird = new THREE.Group();
  bird.name = 'life-size-robin';
  bird.position.set(0, 2.05, 0);
  bird.rotation.y = 0.8;
  bird.scale.setScalar(0.4);
  const model = createModeling(bird), rand = seededRandom(41629);
  const texture = createSurface({ size: 256, normalStrength: 0.6,
    height: (u, v) => 0.5 + Math.sin(u * 610 + Math.sin(v * 210) * 2) * 0.09 + fbm2D(u, v, 60, 90, 41) * 0.12,
    color: (_u, _v, h) => [0.88 + h * 0.12, 0.88 + h * 0.12, 0.88 + h * 0.12],
  });
  const plumage = new THREE.MeshPhysicalMaterial({ ...texture, vertexColors: true,
    roughness: 0.90, normalScale: new THREE.Vector2(0.14, 0.14), sheen: 0.45,
    sheenColor: new THREE.Color('#d2be99'), sheenRoughness: 0.85 });
  const body = robinGeometry();
  model.mesh(body, plumage).name = 'continuous-robin-plumage';

  // Dark eyes with a narrow buff orbital ring, rich obsidian-chestnut depth, and a clear corneal reflection.
  const eye = new THREE.MeshPhysicalMaterial({ color: '#0d0907', roughness: 0.04,
    clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.45 });
  const rim = new THREE.MeshStandardMaterial({ color: '#766a50', roughness: 0.85 });
  const eyeSpark = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const side of [-1, 1]) {
    model.ellipsoid(rim, [side * 0.057, 0.17, 0.126], [0.0075, 0.0093, 0.0062], 28).rotation.y = side * 0.9;
    model.ellipsoid(eye, [side * 0.059, 0.171, 0.129], [0.006, 0.0081, 0.0068], 36).rotation.y = side * 0.9;
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), eyeSpark);
    spark.position.set(side * 0.0615, 0.1742, 0.134);
    bird.add(spark);
  }
  // A closed wedge bill with horn sheen and a fine gape following its side.
  const horn = new THREE.MeshPhysicalMaterial({ color: '#2a2620', roughness: 0.45, clearcoat: 0.25 });
  const bill = organicGeometry([[0, 0.136, 0.141], [0, 0.135, 0.157], [0, 0.131, 0.178], [0, 0.128, 0.197]],
    [[0.010, 0.007], [0.008, 0.006], [0.004, 0.0035], [0.0001, 0.0001]], 28, 16);
  model.mesh(bill, horn).name = 'tapered-robin-bill';
  const gape = new THREE.MeshStandardMaterial({ color: '#6e5840', roughness: 0.6 });
  for (const side of [-1, 1]) {
    model.tube(gape, [[side * 0.009, 0.132, 0.151], [side * 0.005, 0.130, 0.176], [0, 0.128, 0.197]], 0.00045, 12);
    model.ellipsoid(eye, [side * 0.0066, 0.138, 0.158], [0.0015, 0.0008, 0.0020], 12);
  }

  const vaneSurface = createSurface({ size: 192, normalStrength: 0.8,
    height: (u, v) => 0.5 + Math.cos((v - Math.abs(u - 0.5) * 0.32) * 250) * 0.10
      + Math.exp(-(((u - 0.5) * 65) ** 2)) * 0.18,
    color: (u, _v, h) => {
      const edge = THREE.MathUtils.smoothstep(Math.abs(u - 0.5), 0.32, 0.49);
      const tone = 0.74 + h * 0.12 + edge * 0.13;
      return [tone, tone, tone];
    },
  });
  const vaneMaterial = new THREE.MeshPhysicalMaterial({ ...vaneSurface, color: '#ffffff',
    side: THREE.DoubleSide, roughness: 0.86, normalScale: new THREE.Vector2(0.18, 0.18),
    sheen: 0.38, sheenColor: new THREE.Color('#dfc9a6'), sheenRoughness: 0.85 });
  const feather = featherGeometry();
  const wings = new THREE.InstancedMesh(feather, vaneMaterial, 78);
  wings.name = 'layered-folded-wings';
  const transform = new THREE.Object3D(), color = new THREE.Color();
  // Local +Y follows the vane; local +Z points away from the body.
  const orient = (direction: THREE.Vector3, normal: THREE.Vector3) => {
    const y = direction.clone().normalize();
    const x = new THREE.Vector3().crossVectors(y, normal).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    transform.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  let index = 0;
  for (const side of [-1, 1]) {
    const mantle = new THREE.MeshStandardMaterial({ ...vaneSurface, color: '#807357', roughness: 0.95,
      normalScale: new THREE.Vector2(0.25, 0.25) });
    model.ellipsoid(mantle, [side * 0.092, 0.020, -0.044], [0.027, 0.073, 0.100], 32);
    // Longer primaries below three shingled rows of shorter coverts.
    for (let j = 0; j < 12; j++) {
      const t = j / 11;
      transform.position.set(side * (0.124 + 0.004 * Math.sin(t * Math.PI)), 0.039 - t * 0.077, -0.025);
      orient(new THREE.Vector3(-side * 0.06, -0.40 + t * 0.12, -1), new THREE.Vector3(side, 0.1, 0));
      transform.scale.set(0.026, 0.153 - t * 0.025, 0.009);
      transform.updateMatrix(); wings.setMatrixAt(index, transform.matrix);
      color.set('#76654f').multiplyScalar(0.88 + t * 0.16);
      wings.setColorAt(index++, color);
    }
    for (let row = 0; row < 3; row++) for (let j = 0; j < 9; j++) {
      const t = j / 8;
      const y = 0.072 - t * 0.079 - row * 0.007;
      const z = 0.008 - row * 0.030;
      transform.position.set(side * (0.129 + row * 0.001), y, z);
      orient(new THREE.Vector3(-side * 0.025, -0.45, -1), new THREE.Vector3(side, 0.2, 0.1));
      transform.scale.set(0.026, 0.048 + row * 0.012, 0.005);
      transform.updateMatrix(); wings.setMatrixAt(index, transform.matrix);
      color.set(row === 2 ? '#ab9774' : '#8c8062').multiplyScalar(0.94 + rand() * 0.12);
      wings.setColorAt(index++, color);
    }
  }
  wings.castShadow = wings.receiveShadow = true;
  bird.add(wings);
  // Narrow overlapping tail fan with rounded tips and a subtly lifted carriage.
  const tail = new THREE.InstancedMesh(feather, vaneMaterial, 10);
  tail.name = 'robin-tail-fan';
  for (let i = 0; i < tail.count; i++) {
    const spread = (i - 4.5) / 4.5;
    transform.position.set(spread * 0.028, -0.055, -0.118);
    orient(new THREE.Vector3(spread * 0.13, 0.13, -1), new THREE.Vector3(0, 1, 0));
    transform.scale.set(0.026, 0.185 - Math.abs(spread) * 0.012, 0.008);
    transform.updateMatrix(); tail.setMatrixAt(i, transform.matrix);
    color.set('#9b896d').multiplyScalar(0.9 + rand() * 0.1);
    tail.setColorAt(i, color);
  }
  tail.castShadow = tail.receiveShadow = true;
  bird.add(tail);

  const downMaterial = new THREE.MeshPhysicalMaterial({ ...texture, normalMap: vaneSurface.normalMap,
    vertexColors: true, roughness: 0.95,
    normalScale: new THREE.Vector2(0.12, 0.12), sheen: 0.35,
    sheenColor: new THREE.Color('#d8be94'), sheenRoughness: 0.9, side: THREE.DoubleSide });
  const down = model.mesh(contourPlumage(body, rand), downMaterial);
  down.name = 'surface-following-down';
  down.castShadow = false;

  // Three forward toes and one rear toe curl around the perch, ending in dark claws.
  const scutes = createSurface({ size: 128, repeat: [2, 5], normalStrength: 0.8,
    height: (u, v) => 0.5 + Math.sin(v * Math.PI * 32 + Math.sin(u * Math.PI * 8) * 0.6) * 0.18,
    color: (_u, _v, h) => [0.83 + h * 0.12, 0.82 + h * 0.12, 0.81 + h * 0.12],
  });
  const leg = new THREE.MeshPhysicalMaterial({ ...scutes, color: '#977d69', roughness: 0.78,
    normalScale: new THREE.Vector2(0.18, 0.18), clearcoat: 0.08 });
  const claw = new THREE.MeshPhysicalMaterial({ color: '#383028', roughness: 0.45, clearcoat: 0.25 });
  const toe = (points: [number, number, number][], radius: number, material: THREE.Material, sharp = false) =>
    model.mesh(organicGeometry(points, points.map((_, i) => {
      const r = radius * (1 - i / (points.length - 1) * (sharp ? 0.98 : 0.45));
      return [r, r];
    }), 16, 10), material);
  for (const side of [-1, 1]) {
    const x = side * 0.038;
    toe([[x, -0.108, 0.008], [x, -0.140, 0.018], [x, -0.155, 0.045]], 0.0045, leg);
    for (let digit = -1; digit <= 1; digit++) {
      const tipX = x + digit * 0.017;
      toe([[x, -0.155, 0.045], [x + digit * 0.012, -0.160, 0.072],
        [tipX, -0.181, 0.076]], 0.0027, leg);
      toe([[tipX, -0.180, 0.076], [tipX, -0.188, 0.071],
        [tipX, -0.191, 0.064]], 0.0015, claw, true);
    }
    toe([[x, -0.153, 0.030], [x + side * 0.009, -0.168, -0.022], [x, -0.188, -0.023]], 0.0028, leg);
    toe([[x, -0.187, -0.023], [x, -0.196, -0.016], [x, -0.198, -0.008]], 0.0015, claw, true);
  }
  return bird;
}
