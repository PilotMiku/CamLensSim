import * as THREE from 'three';

/**
 * Builds a small, deterministic studio lighting environment and converts it
 * into a PMREM cube map. Softbox panels give ceramics, brass and glass
 * believable specular reflections without any network assets.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const roomGeometry = new THREE.BoxGeometry(16, 10, 16);
  const roomMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.07, 0.068, 0.06),
    side: THREE.BackSide,
  });
  disposables.push(roomGeometry, roomMaterial);
  scene.add(new THREE.Mesh(roomGeometry, roomMaterial));

  const target = new THREE.Vector3(0, 1.1, 0);
  const panel = (
    width: number,
    height: number,
    position: THREE.Vector3,
    color: THREE.Color,
    lookAt = target,
  ) => {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.lookAt(lookAt);
    scene.add(mesh);
  };

  // Key softbox, high and to camera left.
  panel(4.8, 5.4, new THREE.Vector3(-4.6, 4.8, 4.8), new THREE.Color(6.2, 5.5, 4.5));
  // Cooler fill from camera right.
  panel(3.4, 3.2, new THREE.Vector3(5.2, 2.4, 3.4), new THREE.Color(1.5, 1.8, 2.2));
  // Warm rim from behind.
  panel(2.2, 4.2, new THREE.Vector3(2.4, 4.4, -5.2), new THREE.Color(3.1, 2.6, 2.0));
  // Dim bounce from the floor.
  panel(8, 8, new THREE.Vector3(0, -2.6, 0), new THREE.Color(0.55, 0.46, 0.36));
  // Narrow strip for a crisp highlight along the glaze.
  panel(0.7, 5.6, new THREE.Vector3(-1.4, 3.0, 5.6), new THREE.Color(4.0, 3.8, 3.4));

  const targetCube = pmrem.fromScene(scene, 0.035, 0.1, 40);
  pmrem.dispose();
  for (const item of disposables) item.dispose();
  return targetCube;
}
interface SkyGradient {
  top: string;
  horizon: string;
  bottom: string;
}

function skyColor(stops: SkyGradient, height01: number, target: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, height01));
  const top = new THREE.Color(stops.top);
  const horizon = new THREE.Color(stops.horizon);
  const bottom = new THREE.Color(stops.bottom);
  if (t < 0.5) return target.copy(top).lerp(horizon, t * 2);
  return target.copy(horizon).lerp(bottom, (t - 0.5) * 2);
}

/** A full-sphere sky dome with a smooth vertical gradient, used as the scene background. */
export function createSkyDome(
  radius: number,
  stops: SkyGradient,
): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    skyColor(stops, 0.5 - y / (radius * 2), color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

/**
 * Generic gradient-sky environment built from the scene background plus one
 * bright key panel. Gives PBR materials a plausible outdoor / studio sheen.
 */
export function createGradientEnvironment(
  renderer: THREE.WebGLRenderer,
  stops: SkyGradient,
  key: { color: string; intensity: number; position: [number, number, number] },
  groundBounce: string,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const dome = new THREE.SphereGeometry(30, 48, 24);
  const domePosition = dome.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(domePosition.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < domePosition.count; i++) {
    skyColor(stops, 0.5 - domePosition.getY(i) / 60, color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    toneMapped: false,
  });
  disposables.push(dome, domeMaterial);
  envScene.add(new THREE.Mesh(dome, domeMaterial));

  const panel = (size: number, position: [number, number, number], hex: string, intensity: number) => {
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(intensity, intensity, intensity).multiply(new THREE.Color(hex)),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };

  panel(6, key.position, key.color, key.intensity);
  panel(14, [0, -4, 0], groundBounce, 0.5);

  const targetCube = pmrem.fromScene(envScene, 0.04, 0.1, 60);
  pmrem.dispose();
  for (const item of disposables) item.dispose();
  return targetCube;
}
