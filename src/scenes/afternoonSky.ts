import * as THREE from 'three';
export { SOLAR_ANGULAR_RADIUS } from '../optics/sun';

export type AfternoonScene = 'indoor' | 'outdoor' | 'portrait' | 'animal';

/** An art-directed clear afternoon, around 16:00; sun altitude is about 28 degrees. */
export const AFTERNOON_SUN_DIRECTION = new THREE.Vector3(-0.40, 0.46, -0.79).normalize();
/** Outdoor sets face the afternoon sun from the side/front instead of backlighting the fixtures. */
export const OUTDOOR_SUN_DIRECTION = new THREE.Vector3(-0.40, 0.46, 0.79).normalize();
const CLOUD_WHITE = new THREE.Color('#fff5df');

export interface SkyProfile {
  top: string;
  mid: string;
  horizon: string;
  ground: string;
  sunGlow: [number, number, number];
  cloudColor: string;
  cloudAlt: number;
  cloudWidth: number;
  cloudDensity: number;
  cloudScale: number;
}

export const SKY_PROFILES: Record<AfternoonScene, SkyProfile> = {
  // 高山湖畔：澄澈高原纯净湛蓝、中天蔚蓝、远山微紫冰蓝粉白地平线与高海拔羽状卷云
  outdoor: {
    top: '#124da0',
    mid: '#3d8ed6',
    horizon: '#c8e5f7',
    ground: '#5b6c50',
    sunGlow: [1.15, 0.88, 0.52],
    cloudColor: '#ffffff',
    cloudAlt: 0.35,
    cloudWidth: 0.14,
    cloudDensity: 0.20,
    cloudScale: 1.0,
  },
  // 室外人像：人像摄影绝美黄金时刻（Golden Hour），暮色沉静靛蓝、浪漫玫瑰紫霞与灿烂琥珀金橙地平线
  portrait: {
    top: '#1d3968',
    mid: '#a35d7f',
    horizon: '#ffad66',
    ground: '#57483a',
    sunGlow: [1.45, 0.95, 0.45],
    cloudColor: '#ffd8be',
    cloudAlt: 0.28,
    cloudWidth: 0.16,
    cloudDensity: 0.28,
    cloudScale: 1.15,
  },
  // 林间知更鸟：晨曦幽林，清润薄荷天青、穿透林梢的晨雾奶白微光
  animal: {
    top: '#1c557c',
    mid: '#5395a6',
    horizon: '#cde4db',
    ground: '#424f33',
    sunGlow: [1.10, 0.92, 0.60],
    cloudColor: '#f2fdf7',
    cloudAlt: 0.38,
    cloudWidth: 0.16,
    cloudDensity: 0.18,
    cloudScale: 0.85,
  },
  // 室内静物：明净柔和的欧洲古典画室午后窗景，纯净天蓝与温暖浅米金微粉
  indoor: {
    top: '#2462a4',
    mid: '#699ecf',
    horizon: '#eaf1f7',
    ground: '#7d7465',
    sunGlow: [1.25, 0.92, 0.58],
    cloudColor: '#fffdf5',
    cloudAlt: 0.32,
    cloudWidth: 0.12,
    cloudDensity: 0.14,
    cloudScale: 0.9,
  },
};

export const PALETTES: Record<AfternoonScene, [string, string, string]> = {
  indoor: [SKY_PROFILES.indoor.top, SKY_PROFILES.indoor.horizon, SKY_PROFILES.indoor.ground],
  outdoor: [SKY_PROFILES.outdoor.top, SKY_PROFILES.outdoor.horizon, SKY_PROFILES.outdoor.ground],
  portrait: [SKY_PROFILES.portrait.top, SKY_PROFILES.portrait.horizon, SKY_PROFILES.portrait.ground],
  animal: [SKY_PROFILES.animal.top, SKY_PROFILES.animal.horizon, SKY_PROFILES.animal.ground],
};

/** A continuous direction sampler shared by all six cube faces and the HDR environment. */
export function afternoonSkyColor(
  direction: THREE.Vector3,
  palette: readonly [THREE.Color, THREE.Color, THREE.Color],
  target: THREE.Color,
  _angularFootprint = 0,
  sunDirection = AFTERNOON_SUN_DIRECTION,
  sceneId?: AfternoonScene,
) {
  const [top, horizon, ground] = palette;
  const altitude = direction.y;
  const profile = sceneId ? SKY_PROFILES[sceneId] : null;
  const mid = profile ? new THREE.Color(profile.mid) : horizon.clone().lerp(top, 0.5);

  if (altitude >= 0) {
    const t = Math.pow(altitude, 0.48);
    if (t < 0.45) {
      target.copy(horizon).lerp(mid, t / 0.45);
    } else {
      target.copy(mid).lerp(top, (t - 0.45) / 0.55);
    }
  } else {
    target.copy(horizon).lerp(ground, Math.min(1, -altitude * 3));
  }

  const sunDot = Math.max(0, direction.dot(sunDirection));
  const glowMult = profile ? profile.sunGlow : [1.0, 0.72, 0.35];
  const glow = (Math.pow(sunDot, 28) * 0.38 + Math.pow(sunDot, 160) * 0.18) * (profile ? (profile.sunGlow[0] / 1.15) : 1.0);
  target.r += glow * glowMult[0];
  target.g += glow * glowMult[1];
  target.b += glow * glowMult[2];

  const cloudAlt = profile?.cloudAlt ?? 0.32;
  const cloudWidth = profile?.cloudWidth ?? 0.12;
  const cloudDensity = profile?.cloudDensity ?? 0.16;
  const cloudScale = profile?.cloudScale ?? 1.0;
  const cloudColor = profile ? new THREE.Color(profile.cloudColor) : CLOUD_WHITE;

  const band = Math.exp(-(((altitude - cloudAlt) / cloudWidth) ** 2));
  if (band > 0.01) {
    const s = cloudScale;
    const streak1 = Math.sin(direction.x * 22 * s + direction.z * 11 * s + Math.sin(direction.z * 16 * s) * 1.4);
    const streak2 = Math.sin(direction.x * 41 * s - direction.z * 27 * s + Math.cos(direction.x * 23 * s) * 1.1);
    const cloudNoise = streak1 * 0.65 + streak2 * 0.35;
    const cloud = THREE.MathUtils.smoothstep(cloudNoise, 0.60, 0.98) * band * cloudDensity;
    const cloudSunRim = THREE.MathUtils.smoothstep(sunDot, 0.4, 0.9) * 0.4;
    const finalCloud = cloudColor.clone().addScalar(cloudSunRim);
    target.lerp(finalCloud, cloud);
  }
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
      afternoonSkyColor(direction, palette, color, 2 / faceSize, sunDirection, id).convertLinearToSRGB();
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
    afternoonSkyColor(direction, palette, color, Math.PI * 2 / width, sunDirection, id);
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
