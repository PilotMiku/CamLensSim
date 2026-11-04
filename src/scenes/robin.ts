import * as THREE from 'three';
import { createModeling } from './modeling';
import { createSurface, fbm2D } from './textures';
import { seededRandom } from './helpers';

/** A single lofted body and head avoids a visible ball-to-ball neck seam. */
function robinGeometry() {
  const profile = [
    [-0.145, 0.005, 0.008, 0.0], [-0.11, 0.080, 0.107, 0.01],
    [-0.04, 0.119, 0.149, 0.004], [0.035, 0.116, 0.143, 0.006],
    [0.095, 0.090, 0.101, 0.044], [0.139, 0.075, 0.074, 0.086],
    [0.178, 0.065, 0.062, 0.09], [0.211, 0.025, 0.025, 0.087], [0.216, 0.001, 0.001, 0.087],
  ];
  const rx = new THREE.SplineCurve(profile.map(([y, x]) => new THREE.Vector2(y, x)));
  const rz = new THREE.SplineCurve(profile.map(([y, _x, z]) => new THREE.Vector2(y, z)));
  const center = new THREE.SplineCurve(profile.map(([y, _x, _z, zc]) => new THREE.Vector2(y, zc)));
  const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  const rows = 120, sides = 96;
  const color = new THREE.Color(), brown = new THREE.Color('#756957'), buff = new THREE.Color('#e1d8bf'), rust = new THREE.Color('#d27936');
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, p = rx.getPoint(t), depth = Math.max(0.001, rz.getPoint(t).y), zc = center.getPoint(t).y;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, front = Math.sin(a);
      const x = Math.cos(a) * Math.max(0.001, p.y), z = zc + front * depth;
      positions.push(x, p.x, z);
      const belly = (1 - THREE.MathUtils.smoothstep(p.x, -0.10, 0.0)) * THREE.MathUtils.smoothstep(front, -0.45, 0.3);
      const bib = THREE.MathUtils.smoothstep(front + 0.025 * Math.sin(row * 2.3 + j * 1.7), -0.05, 0.55)
        * THREE.MathUtils.smoothstep(p.x, -0.065, -0.012) * (1 - THREE.MathUtils.smoothstep(p.x, 0.175, 0.205));
      color.copy(brown).lerp(buff, belly).lerp(rust, bib);
      color.multiplyScalar(0.98 + Math.sin(j * 0.8 + row * 1.6) * 0.02);
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
  const rows = 18, cols = 8;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const width = 0.5 * Math.pow(Math.sin(Math.PI * (0.025 + t * 0.95)), 0.58) * (1 - 0.28 * t);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols, x = u * 2 - 1;
      positions.push(x * width, t, (1 - x * x) * 0.28 * Math.sin(Math.PI * t) + t * t * 0.12);
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

/** Local modelling units are scaled to a small, life-size perched subject. */
export function createRobin() {
  const bird = new THREE.Group();
  bird.name = 'life-size-robin';
  bird.position.set(0, 2.02, 0);
  bird.rotation.y = 0.8;
  bird.scale.setScalar(0.4);
  const model = createModeling(bird), rand = seededRandom(41629);
  const texture = createSurface({ size: 256, normalStrength: 0.6,
    height: (u, v) => 0.5 + Math.sin(u * 610 + Math.sin(v * 210) * 2) * 0.09 + fbm2D(u, v, 60, 90, 41) * 0.12,
    color: (_u, _v, h) => [0.88 + h * 0.12, 0.88 + h * 0.12, 0.88 + h * 0.12],
  });
  const plumage = new THREE.MeshPhysicalMaterial({ ...texture, vertexColors: true,
    roughness: 0.92, normalScale: new THREE.Vector2(0.13, 0.13), sheen: 0.3,
    sheenColor: new THREE.Color('#baaa88'), sheenRoughness: 1 });
  const body = robinGeometry();
  model.mesh(body, plumage).name = 'continuous-robin-plumage';

  // Dark eyes with a narrow buff orbital ring and a clear corneal reflection.
  const eye = new THREE.MeshPhysicalMaterial({ color: '#080a08', roughness: 0.09,
    clearcoat: 1, clearcoatRoughness: 0.04, ior: 1.38 });
  const rim = new THREE.MeshStandardMaterial({ color: '#b29c78', roughness: 0.9 });
  for (const side of [-1, 1]) {
    model.ellipsoid(rim, [side * 0.059, 0.17, 0.128], [0.009, 0.012, 0.0085], 28).rotation.y = side * 0.9;
    model.ellipsoid(eye, [side * 0.062, 0.171, 0.132], [0.007, 0.0105, 0.008], 36).rotation.y = side * 0.9;
  }
  // A closed wedge bill replaces the overlapping cones; a fine gape follows its side.
  const horn = new THREE.MeshStandardMaterial({ color: '#302c26', roughness: 0.5 });
  const bill = new THREE.BufferGeometry();
  bill.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.012, 0.133, 0.145, 0.012, 0.133, 0.145, 0, 0.145, 0.148,
    0, 0.125, 0.148, 0, 0.128, 0.207,
  ], 3));
  bill.setIndex([0, 4, 2, 2, 4, 1, 1, 4, 3, 3, 4, 0, 0, 1, 3, 0, 2, 1]);
  bill.computeVertexNormals();
  model.mesh(bill, horn).name = 'tapered-robin-bill';
  const gape = new THREE.MeshStandardMaterial({ color: '#171812', roughness: 0.75 });
  for (const side of [-1, 1]) {
    model.tube(gape, [[side * 0.012, 0.132, 0.15], [side * 0.006, 0.130, 0.177], [0, 0.128, 0.206]], 0.0007, 12);
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
    side: THREE.DoubleSide, roughness: 0.88, normalScale: new THREE.Vector2(0.17, 0.17),
    sheen: 0.25, sheenRoughness: 0.9 });
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
    const mantle = new THREE.MeshStandardMaterial({ color: '#75654f', roughness: 0.95 });
    model.ellipsoid(mantle, [side * 0.099, 0.025, -0.035], [0.032, 0.077, 0.110], 32);
    // Longer primaries below three shingled rows of shorter coverts.
    for (let j = 0; j < 12; j++) {
      const t = j / 11;
      transform.position.set(side * (0.113 + 0.012 * Math.sin(t * Math.PI)), 0.039 - t * 0.082, -0.033);
      orient(new THREE.Vector3(-side * 0.10, -0.32 + t * 0.12, -1), new THREE.Vector3(side, 0.1, 0));
      transform.scale.set(0.026, 0.153 - t * 0.025, 0.009);
      transform.updateMatrix(); wings.setMatrixAt(index, transform.matrix);
      color.set('#76654f').multiplyScalar(0.88 + t * 0.16);
      wings.setColorAt(index++, color);
    }
    for (let row = 0; row < 3; row++) for (let j = 0; j < 9; j++) {
      const t = j / 8;
      transform.position.set(side * (0.126 + Math.sin(t * Math.PI) * 0.008),
        0.078 - t * 0.091 - row * 0.007, 0.018 - row * 0.032);
      orient(new THREE.Vector3(-side * 0.1, -0.4, -1), new THREE.Vector3(side, 0.2, 0.1));
      transform.scale.set(0.025, 0.046 + row * 0.012, 0.009);
      transform.updateMatrix(); wings.setMatrixAt(index, transform.matrix);
      color.set('#c4ad87').multiplyScalar(0.89 + rand() * 0.16);
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
    transform.scale.set(0.029, 0.235 - Math.abs(spread) * 0.015, 0.010);
    transform.updateMatrix(); tail.setMatrixAt(i, transform.matrix);
    color.set('#9b896d').multiplyScalar(0.9 + rand() * 0.1);
    tail.setColorAt(i, color);
  }
  tail.castShadow = tail.receiveShadow = true;
  bird.add(tail);

  // Down lies on the actual lofted surface, sharing its colour and tangent.
  // Avoid the eye and bill region so tiny feather cards cannot obscure focus.
  const downMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
  const down = new THREE.InstancedMesh(feather, downMaterial, 1100);
  down.name = 'surface-following-down';
  const positions = body.attributes.position, normals = body.attributes.normal, colors = body.attributes.color;
  for (let i = 0; i < down.count; i++) {
    const row = 8 + Math.floor(rand() * 79), column = Math.floor(rand() * 96);
    const vertex = row * 97 + column;
    const normal = new THREE.Vector3().fromBufferAttribute(normals, vertex);
    transform.position.fromBufferAttribute(positions, vertex).addScaledVector(normal, 0.0008);
    const direction = new THREE.Vector3(0, -1, -0.12);
    direction.addScaledVector(normal, -direction.dot(normal));
    orient(direction, normal);
    transform.scale.set(0.007 + rand() * 0.004, 0.010 + rand() * 0.006, 0.002);
    transform.updateMatrix(); down.setMatrixAt(i, transform.matrix);
    color.fromBufferAttribute(colors, vertex).multiplyScalar(0.96 + rand() * 0.08);
    down.setColorAt(i, color);
  }
  down.receiveShadow = true;
  bird.add(down);

  // Three forward toes and one rear toe curl around the perch, ending in dark claws.
  const leg = new THREE.MeshStandardMaterial({ color: '#927564', roughness: 0.8 });
  const claw = new THREE.MeshStandardMaterial({ color: '#453e35', roughness: 0.6 });
  for (const side of [-1, 1]) {
    const x = side * 0.038;
    model.tube(leg, [[x, -0.108, 0.008], [x, -0.140, 0.018], [x, -0.155, 0.045]], 0.004, 16);
    for (let toe = -1; toe <= 1; toe++) {
      const tipX = x + toe * 0.017;
      model.tube(leg, [[x, -0.155, 0.045], [x + toe * 0.012, -0.160, 0.072],
        [tipX, -0.181, 0.076]], 0.0024, 16);
      model.tube(claw, [[tipX, -0.180, 0.076], [tipX, -0.188, 0.071],
        [tipX, -0.191, 0.064]], 0.0014, 10);
    }
    model.tube(leg, [[x, -0.153, 0.030], [x + side * 0.009, -0.168, -0.022], [x, -0.188, -0.023]], 0.0026, 16);
    model.tube(claw, [[x, -0.187, -0.023], [x, -0.196, -0.016], [x, -0.198, -0.008]], 0.0014, 10);
  }
  return bird;
}
