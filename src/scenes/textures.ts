import * as THREE from 'three';

/**
 * Small procedural texture bench. Everything is generated locally and
 * deterministically so screenshots and lighting stay reproducible.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (value: number, period: number) => ((value % period) + period) % period;

function valueNoise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const x0 = wrap(xi, periodX);
  const x1 = wrap(xi + 1, periodX);
  const y0 = wrap(yi, periodY);
  const y1 = wrap(yi + 1, periodY);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Seamless fractal noise over [0,1) with integer lattice periods. */
export function fbm2D(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  seed: number,
  octaves = 4,
): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let px = Math.max(1, Math.round(periodX));
  let py = Math.max(1, Math.round(periodY));
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(u * px, v * py, px, py, seed + i * 131) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / norm;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const channel = (value: number) => Math.round(clamp01(value) * 255);

function makeTexture(canvas: HTMLCanvasElement, repeat: [number, number], srgb: boolean) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  return texture;
}

function normalTexture(height: Float32Array, size: number, strength: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = height[y * size + wrap(x - 1, size)];
      const right = height[y * size + wrap(x + 1, size)];
      const up = height[wrap(y - 1, size) * size + x];
      const down = height[wrap(y + 1, size) * size + x];
      let nx = (left - right) * strength;
      let ny = (down - up) * strength;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const offset = (y * size + x) * 4;
      data[offset] = channel(nx * 0.5 + 0.5);
      data[offset + 1] = channel(ny * 0.5 + 0.5);
      data[offset + 2] = channel(nz * 0.5 + 0.5);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function dataTexture(values: Float32Array, size: number) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < values.length; i++) {
    const value = channel(values[i]);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

interface SurfaceSpec {
  size?: number;
  repeat?: [number, number];
  normalStrength?: number;
  /** Returns linear 0..1 RGB. */
  color: (u: number, v: number, height: number) => [number, number, number];
  height: (u: number, v: number) => number;
  roughness?: (u: number, v: number, height: number) => number;
}

export function createSurface(spec: SurfaceSpec): SurfaceTextures {
  const size = spec.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) throw new Error('Unable to create a 2D texture context');
  const image = context.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const roughness = spec.roughness ? new Float32Array(size * size) : undefined;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const height = spec.height(u, v);
      const index = y * size + x;
      heights[index] = height;
      const [r, g, b] = spec.color(u, v, height);
      const offset = index * 4;
      image.data[offset] = channel(r);
      image.data[offset + 1] = channel(g);
      image.data[offset + 2] = channel(b);
      image.data[offset + 3] = 255;
      if (roughness && spec.roughness) roughness[index] = clamp01(spec.roughness(u, v, height));
    }
  }
  context.putImageData(image, 0, 0);
  const repeat = spec.repeat ?? [1, 1];
  const result: SurfaceTextures = {
    map: makeTexture(canvas, repeat, true),
    normalMap: normalTexture(heights, size, spec.normalStrength ?? 24),
  };
  result.normalMap.repeat.set(repeat[0], repeat[1]);
  if (roughness) {
    result.roughnessMap = dataTexture(roughness, size);
    result.roughnessMap.repeat.set(repeat[0], repeat[1]);
  }
  return result;
}

/** Warm seamless plaster, used for the cyclorama. */
export function createPlasterSurface(): SurfaceTextures {
  return createSurface({
    size: 256,
    repeat: [4, 3],
    normalStrength: 2.4,
    height: (u, v) => fbm2D(u, v, 6, 6, 11, 4) * 0.7 + fbm2D(u, v, 48, 48, 21, 2) * 0.3,
    color: (u, v) => {
      const broad = fbm2D(u, v, 3, 3, 31, 3);
      const fine = fbm2D(u, v, 96, 96, 47, 2);
      const tone = 0.83 + broad * 0.11 + fine * 0.04;
      return [tone * 1.02, tone * 0.985, tone * 0.93];
    },
    roughness: (_u, _v, h) => 0.9 + h * 0.06,
  });
}

/** Oiled walnut with directional grain and pores. */
export function createWoodSurface(): SurfaceTextures {
  return createSurface({
    size: 512,
    repeat: [1, 1],
    normalStrength: 0.75,
    height: (u, v) => {
      const warp = fbm2D(u, v, 2, 5, 101, 4);
      const wobble = fbm2D(u, v, 7, 3, 133, 2);
      const rings = Math.sin((v * 58 + warp * 5.5 + wobble * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      const pores = fbm2D(u, v, 260, 120, 131, 2);
      return rings * 0.5 + pores * 0.5;
    },
    color: (u, v, h) => {
      const warp = fbm2D(u, v, 3, 7, 101, 3);
      const streak = fbm2D(u, v, 120, 12, 151, 2);
      const t = clamp01(h * 0.35 + streak * 0.5 + warp * 0.15);
      const dark = [0.265, 0.18, 0.115];
      const mid = [0.3, 0.21, 0.14];
      const light = [0.34, 0.245, 0.17];
      const base =
        t < 0.5
          ? [
              mix(dark[0], mid[0], t * 2),
              mix(dark[1], mid[1], t * 2),
              mix(dark[2], mid[2], t * 2),
            ]
          : [
              mix(mid[0], light[0], (t - 0.5) * 2),
              mix(mid[1], light[1], (t - 0.5) * 2),
              mix(mid[2], light[2], (t - 0.5) * 2),
            ];
      return [base[0] * 1.04, base[1], base[2] * 0.94];
    },
    roughness: (u, v, h) => 0.6 + fbm2D(u, v, 40, 12, 161, 2) * 0.18 + h * 0.06,
  });
}

/** Slubby linen with a woven normal map. */
export function createLinenSurface(): SurfaceTextures {
  return createSurface({
    size: 256,
    repeat: [3, 3],
    normalStrength: 0.6,
    height: (u, v) => {
      const warp = Math.sin(u * Math.PI * 2 * 44) * 0.5 + 0.5;
      const weft = Math.sin(v * Math.PI * 2 * 44) * 0.5 + 0.5;
      const slub = fbm2D(u, v, 12, 30, 211, 3);
      return warp * weft * 0.55 + slub * 0.45;
    },
    color: (u, v, h) => {
      const slub = fbm2D(u, v, 9, 24, 231, 3);
      const tone = 0.62 + h * 0.07 + slub * 0.06;
      return [tone, tone * 0.965, tone * 0.89];
    },
    roughness: () => 0.92,
  });
}

/** Satin glazed stoneware with speckles and a slight throwing texture. */
export function createStonewareSurface(seed = 301, base: [number, number, number] = [0.55, 0.3, 0.18]): SurfaceTextures {
  return createSurface({
    size: 256,
    repeat: [2, 1],
    normalStrength: 1.0,
    height: (u, v) => {
      const throwMarks = Math.sin(v * Math.PI * 2 * 22 + fbm2D(u, v, 4, 16, seed, 2) * 5) * 0.5 + 0.5;
      return throwMarks * 0.22 + fbm2D(u, v, 14, 14, seed + 7, 3) * 0.78;
    },
    color: (u, v, h) => {
      const glaze = fbm2D(u, v, 5, 5, seed + 13, 4);
      const speck = fbm2D(u, v, 220, 220, seed + 29, 1);
      const tone = 0.78 + glaze * 0.18 + h * 0.03;
      const dark = speck > 0.87 ? 0.74 : 1;
      return [base[0] * tone * dark, base[1] * tone * dark, base[2] * tone * dark];
    },
    roughness: (u, v) => 0.48 + fbm2D(u, v, 8, 8, seed + 41, 2) * 0.24,
  });
}

/** Cotton rag paper for the framed print. */
export function createPaperSurface(): SurfaceTextures {
  return createSurface({
    size: 256,
    repeat: [1, 1],
    normalStrength: 1.6,
    height: (u, v) => fbm2D(u, v, 20, 20, 401, 4),
    color: (u, v) => {
      const fiber = fbm2D(u, v, 70, 70, 421, 3);
      const tone = 0.9 + fiber * 0.07;
      return [tone, tone * 0.985, tone * 0.94];
    },
    roughness: () => 0.88,
  });
}

/** Deterministic abstract print for the background frame. */
export function createArtworkTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.round(size * 1.3);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the artwork canvas');
  const height = canvas.height;
  context.fillStyle = '#e9dfcc';
  context.fillRect(0, 0, size, height);
  const gradient = context.createLinearGradient(0, 0, size, height);
  gradient.addColorStop(0, 'rgba(233,223,204,0)');
  gradient.addColorStop(1, 'rgba(196,170,132,0.22)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, height);
  context.fillStyle = '#b2603c';
  context.beginPath();
  context.ellipse(size * 0.47, height * 0.38, size * 0.27, size * 0.23, -0.18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(72,88,72,0.85)';
  context.beginPath();
  context.ellipse(size * 0.62, height * 0.62, size * 0.2, size * 0.31, 0.5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(240,232,214,0.75)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(size * 0.24, height * 0.72);
  context.bezierCurveTo(size * 0.4, height * 0.6, size * 0.55, height * 0.8, size * 0.78, height * 0.66);
  context.stroke();
  // Fine, deterministic paper grain.
  const image = context.getImageData(0, 0, size, height);
  let grain = 20180527;
  for (let i = 0; i < image.data.length; i += 4) {
    grain = (Math.imul(grain, 1664525) + 1013904223) >>> 0;
    const n = ((grain >>> 8) / 16777216 - 0.5) * 9;
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + n));
    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + n));
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Soft radial falloff used for cheap contact shadows. */
export function createContactShadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the shadow canvas');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.62)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Micro-scale capillary water ripple normal map for lake surfaces. */
export function createWaterNormalTexture(size = 256): THREE.DataTexture {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const w1 = Math.sin((u * 12.0 + v * 8.0) * Math.PI * 2.0);
      const w2 = Math.sin((u * 22.0 - v * 16.0) * Math.PI * 2.0);
      const w3 = Math.sin((v * 36.0 + u * 10.0) * Math.PI * 2.0);
      const noise = fbm2D(u, v, 12, 12, 7919, 3);
      heights[y * size + x] = w1 * 0.45 + w2 * 0.28 + w3 * 0.15 + noise * 0.12;
    }
  }
  const texture = normalTexture(heights, size, 8.0);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  return texture;
}
