import * as THREE from 'three';

/** Bake raster fill lights into radiance that the tracer can sample and occlude. */
export function bakeEnvironmentFill(scene: THREE.Scene, environment: THREE.DataTexture) {
  const ambient = new THREE.Color(0, 0, 0);
  const hemispheres: Array<{ sky: THREE.Color; ground: THREE.Color; up: THREE.Vector3 }> = [];
  scene.traverseVisible(object => {
    if (object instanceof THREE.AmbientLight) ambient.add(object.color.clone().multiplyScalar(object.intensity));
    if (object instanceof THREE.HemisphereLight) {
      const up = object.getWorldPosition(new THREE.Vector3()).normalize();
      hemispheres.push({ sky: object.color.clone().multiplyScalar(object.intensity),
        ground: object.groundColor.clone().multiplyScalar(object.intensity), up });
    }
  });
  if (!hemispheres.length && ambient.r === 0 && ambient.g === 0 && ambient.b === 0) return false;
  const { width, height, data } = environment.image;
  // Texture.clone shares Source/image data. Own the pixels before changing them.
  const pixels = new Float32Array(data as Float32Array);
  const direction = new THREE.Vector3(), fill = new THREE.Color(), color = new THREE.Color();
  const intensity = scene.environmentIntensity;
  // Ambient/Hemisphere intensities are irradiance; a Lambertian environment's
  // irradiance is PI times its radiance. Compensate the scene's HDR multiplier.
  const scale = 1 / (Math.PI * (intensity > 0 ? intensity : 1));
  const base = intensity > 0 ? 1 : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const phi = ((x + 0.5) / width - 0.5) * Math.PI * 2;
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    direction.set(Math.cos(latitude) * Math.cos(phi), Math.sin(latitude), Math.cos(latitude) * Math.sin(phi));
    fill.copy(ambient);
    for (const hemisphere of hemispheres) {
      color.copy(hemisphere.ground).lerp(hemisphere.sky, direction.dot(hemisphere.up) * 0.5 + 0.5);
      fill.add(color);
    }
    const i = (y * width + x) * 4;
    pixels[i] = pixels[i] * base + fill.r * scale;
    pixels[i + 1] = pixels[i + 1] * base + fill.g * scale;
    pixels[i + 2] = pixels[i + 2] * base + fill.b * scale;
  }
  environment.source = new THREE.Source({ data: pixels, width, height });
  environment.needsUpdate = true;
  return true;
}
