import * as THREE from 'three';
export { SOLAR_ANGULAR_RADIUS } from '../optics/sun';

export type AfternoonScene = 'indoor' | 'outdoor' | 'portrait' | 'animal';

/** An art-directed clear afternoon, around 16:00; sun altitude is about 28 degrees. */
export const AFTERNOON_SUN_DIRECTION = new THREE.Vector3(-0.40, 0.46, -0.79).normalize();
/** Outdoor sets face the afternoon sun from the side/front instead of backlighting the fixtures. */
export const OUTDOOR_SUN_DIRECTION = new THREE.Vector3(-0.40, 0.46, 0.79).normalize();
const CLOUD_WHITE = new THREE.Color('#fff5df');

const PALETTES: Record<AfternoonScene, [string, string, string]> = {
  indoor: ['#367fc1', '#d8e9f3', '#908575'],
  outdoor: ['#2679c5', '#c1def3', '#81856a'],
  portrait: ['#3b8acb', '#d3e6ef', '#828362'],
  animal: ['#307fc0', '#c9e3ed', '#727b52'],
};

/** A continuous direction sampler is shared by all six cube faces and the HDR environment. */
export function afternoonSkyColor(direction: THREE.Vector3, palette: readonly [THREE.Color, THREE.Color, THREE.Color], target: THREE.Color,
  _angularFootprint = 0, sunDirection = AFTERNOON_SUN_DIRECTION) {
  const [top, horizon, ground] = palette;
  const altitude = direction.y;
  if (altitude >= 0) target.copy(horizon).lerp(top, Math.pow(altitude, 0.48));
  else target.copy(horizon).lerp(ground, Math.min(1, -altitude * 3));
  const sunDot = Math.max(0, direction.dot(sunDirection));
  const glow = Math.pow(sunDot, 32) * 0.30 + Math.pow(sunDot, 180) * 0.12;
  target.r += glow; target.g += glow * 0.72; target.b += glow * 0.35;
  // Sparse high cirrus; most of the sky remains clear blue.
  const band = Math.exp(-(((altitude - 0.32) / 0.11) ** 2));
  const streak = Math.sin(direction.x * 24 + direction.z * 11 + Math.sin(direction.z * 19) * 1.2);
  const cloud = THREE.MathUtils.smoothstep(streak, 0.80, 1) * band * 0.13;
  target.lerp(CLOUD_WHITE, cloud);
  // Only atmospheric sky/glow lives in the environment. The solar disk is sampled separately.
  return target;
}

export function createAfternoonSky(id: AfternoonScene, faceSize = 128) {
  const sunDirection = id === 'indoor' ? AFTERNOON_SUN_DIRECTION : OUTDOOR_SUN_DIRECTION;
  const palette = PALETTES[id].map(hex => new THREE.Color(hex)) as [THREE.Color, THREE.Color, THREE.Color];
  const direction = new THREE.Vector3(), color = new THREE.Color();
  const faces: THREE.DataTexture[] = [];
  const faceDirection = (face: number, u: number, v: number) => {
    switch (face) {
      case 0: return direction.set(1, -v, -u).normalize();
      case 1: return direction.set(-1, -v, u).normalize();
      case 2: return direction.set(u, 1, v).normalize();
      case 3: return direction.set(u, -1, -v).normalize();
      case 4: return direction.set(u, -v, 1).normalize();
      default: return direction.set(-u, -v, -1).normalize();
    }
  };
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(faceSize * faceSize * 4);
    for (let y = 0; y < faceSize; y++) for (let x = 0; x < faceSize; x++) {
      faceDirection(face, (x + 0.5) / faceSize * 2 - 1, (y + 0.5) / faceSize * 2 - 1);
      // Three.js flips X for image-based CubeTexture backgrounds.
      direction.x *= -1;
      afternoonSkyColor(direction, palette, color, 2 / faceSize, sunDirection).convertLinearToSRGB();
      const i = (y * faceSize + x) * 4;
      data[i] = Math.round(Math.min(color.r, 1) * 255); data[i + 1] = Math.round(Math.min(color.g, 1) * 255);
      data[i + 2] = Math.round(Math.min(color.b, 1) * 255); data[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, faceSize, faceSize, THREE.RGBAFormat, THREE.UnsignedByteType);
    faces.push(texture);
  }
  const skybox = new THREE.CubeTexture(faces);
  skybox.type = THREE.UnsignedByteType;
  skybox.colorSpace = THREE.SRGBColorSpace;
  skybox.minFilter = skybox.magFilter = THREE.LinearFilter;
  skybox.generateMipmaps = false;
  skybox.needsUpdate = true;
  skybox.name = `${id}-clear-afternoon-skybox`;

  const width = faceSize * 4, height = faceSize * 2, pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const phi = ((x + 0.5) / width - 0.5) * Math.PI * 2, latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    direction.set(Math.cos(latitude) * Math.cos(phi), Math.sin(latitude), Math.cos(latitude) * Math.sin(phi));
    const i = (y * width + x) * 4;
    afternoonSkyColor(direction, palette, color, Math.PI * 2 / width, sunDirection);
    pixels[i] = color.r; pixels[i + 1] = color.g; pixels[i + 2] = color.b; pixels[i + 3] = 1;
  }
  const environment = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.LinearSRGBColorSpace;
  environment.minFilter = environment.magFilter = THREE.LinearFilter;
  environment.needsUpdate = true;
  environment.name = `${id}-clear-afternoon-environment`;
  return { skybox, environment, lightingEnvironment: environment, weather: 'clear' as const, time: '16:00' as const,
    sunDirection: sunDirection.clone(),
    dispose() { skybox.dispose(); faces.forEach(face => face.dispose()); environment.dispose(); },
  };
}

export function applyAfternoonSky(scene: THREE.Scene, id: AfternoonScene) {
  const sky = createAfternoonSky(id);
  scene.background = sky.skybox;
  scene.environment = sky.lightingEnvironment;
  // Outdoor shade receives the full sky. Halving it made lamps under trees read
  // almost black in the physical preview, which has no raster hemisphere fill.
  scene.environmentIntensity = id === 'indoor' ? 0.30 : 1.0;
  return sky;
}

export function positionAfternoonSun(sun: THREE.DirectionalLight, distance: number, direction = AFTERNOON_SUN_DIRECTION) {
  sun.color.set('#ffecd0');
  sun.position.copy(sun.target.position).addScaledVector(direction, distance);
}
