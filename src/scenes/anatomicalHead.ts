import * as THREE from 'three';
import asset from './assets/portrait-head.json';

/** Decode local CC0 anatomical mesh; no network or asynchronous model loading. */
export function anatomicalHead() {
  const decode = (value: string) => {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new DataView(bytes.buffer);
  };
  const packed = decode(asset.positions), packedIndices = decode(asset.indices);
  const positions = new Float32Array(asset.vertices * 3), uv = new Float32Array(asset.vertices * 2);
  const colors = new Float32Array(asset.vertices * 3), indices = new Uint16Array(asset.triangles * 3);
  const base = new THREE.Color('#f0cbb2'), blush = new THREE.Color('#e59183'), noseTip = new THREE.Color('#e29587'), lips = new THREE.Color('#bf6860'), shadow = new THREE.Color('#bda49c');
  for (let i = 0; i < positions.length; i++) positions[i] = packed.getInt16(i * 2, true) * asset.quantization;
  for (let i = 0; i < indices.length; i++) indices[i] = packedIndices.getUint16(i * 2, true);
  const color = new THREE.Color();
  for (let i = 0; i < asset.vertices; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    uv[i * 2] = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = (y + 0.11) / 0.24;
    const front = THREE.MathUtils.smoothstep(z, 0.03, 0.07);
    const cheek = Math.exp(-(((Math.abs(x) - 0.038) / 0.019) ** 2) - ((y + 0.007) / 0.017) ** 2) * front;
    const nose = Math.exp(-((x / 0.010) ** 2) - ((y + 0.010) / 0.010) ** 2) * front;
    const lip = Math.exp(-((x / 0.022) ** 4) - ((y + 0.043) / 0.005) ** 4) * front;
    const eyeCrease = Math.exp(-(((Math.abs(x) - 0.031) / 0.017) ** 2) - ((y - 0.030) / 0.012) ** 2) * front;
    color.copy(base)
      .lerp(blush, cheek * 0.32)
      .lerp(noseTip, nose * 0.18)
      .lerp(lips, lip * 0.88)
      .lerp(shadow, eyeCrease * 0.16);
    color.toArray(colors, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
