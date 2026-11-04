import * as THREE from 'three';

/** The visible disc and glow share the actual directional light's direction. */
export function addVisibleSun(scene: THREE.Scene, sun: THREE.DirectionalLight, distance: number) {
  const direction = sun.position.clone().sub(sun.target.position).normalize();
  const group = new THREE.Group();
  group.name = 'visible-sun';
  group.position.copy(direction).multiplyScalar(distance).add(sun.target.position);
  group.lookAt(sun.target.position);
  for (const [radius, opacity] of [[0.00465, 1], [0.008, 0.16], [0.016, 0.045], [0.030, 0.012]]) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 5.8, 3.8),
      toneMapped: false, transparent: opacity < 1, opacity, depthWrite: false, fog: false,
      blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(distance * radius, 64), material);
    disc.raycast = () => {};
    group.add(disc);
  }
  scene.add(group);
}
