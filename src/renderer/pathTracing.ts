import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera } from 'three-gpu-pathtracer';
import { createPathTracingScene } from './pathTracingScene';
import type { SceneInstance } from '../scenes/types';

export function configurePhysicalCamera(camera: PhysicalCamera, source: THREE.PerspectiveCamera,
  lens: { focalMm: number; aperture: number; focusM: number; blades: number }, dof: boolean, sensorHeight: number) {
  camera.copy(source);
  // PhysicalCamera.copy expects another PhysicalCamera; restore its extra fields explicitly.
  camera.apertureRotation = 0;
  camera.anamorphicRatio = 1;
  camera.filmGauge = sensorHeight * Math.max(source.aspect, 1);
  camera.focusDistance = lens.focusM;
  camera.bokehSize = dof ? lens.focalMm / lens.aperture : 0;
  camera.apertureBlades = lens.blades;
}

export class PathTracingPreview {
  private readonly tracer!: WebGLPathTracer;
  private readonly physicalWorld: ReturnType<typeof createPathTracingScene>;
  private readonly camera = new PhysicalCamera();
  constructor(renderer: THREE.WebGLRenderer, world: SceneInstance, source: THREE.PerspectiveCamera) {
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('设备不支持光追所需的浮点渲染');
    this.physicalWorld = createPathTracingScene(world);
    try {
    this.tracer = new WebGLPathTracer(renderer);
    this.tracer.textureSize.set(256, 256);
    this.tracer.bounces = 6;
    this.tracer.transmissiveBounces = 8;
    this.tracer.filterGlossyFactor = 0.5;
    this.tracer.tiles.set(2, 2);
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 1;
    this.tracer.fadeDuration = 0;
    this.tracer.rasterizeScene = false;
    this.tracer.renderToCanvas = true;
    configurePhysicalCamera(this.camera, source, { focalMm: 50, aperture: 1.8, focusM: 2.4, blades: 9 }, false, 24);
    this.tracer.setScene(this.physicalWorld.scene, this.camera);
    } catch (error) { this.tracer?.dispose(); this.physicalWorld.dispose(); throw error; }
  }
  update(source: THREE.PerspectiveCamera, lens: { focalMm: number; aperture: number; focusM: number; blades: number }, dof: boolean, low: boolean, sensorHeight: number) {
    configurePhysicalCamera(this.camera, source, lens, dof, sensorHeight);
    this.tracer.renderScale = low ? 0.45 : 0.7;
    this.tracer.updateCamera();
    this.tracer.reset();
  }
  render() { this.tracer.renderSample(); return Math.floor(this.tracer.samples); }
  dispose() { this.tracer.dispose(); this.physicalWorld.dispose(); }
}
