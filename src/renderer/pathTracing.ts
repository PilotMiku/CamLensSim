import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera } from 'three-gpu-pathtracer';
import { createPathTracingScene } from './pathTracingScene';
import type { SceneInstance } from '../scenes/types';
import { installTracerSolarBackground } from './physicalSun';
import { PathTracingDenoiser } from './pathTracingDenoise';

export function configurePhysicalCamera(camera: PhysicalCamera, source: THREE.PerspectiveCamera,
  lens: { focalMm: number; aperture: number; focusM: number; blades: number }, dof: boolean, sensorHeight: number) {
  camera.copy(source);
  // PhysicalCamera.copy expects another PhysicalCamera; restore its extra fields explicitly.
  camera.apertureRotation = 0;
  camera.anamorphicRatio = 1;
  camera.filmGauge = sensorHeight * Math.max(source.aspect, 1);
  // The library constructs a focal point by multiplying a ray by this distance.
  // Keep it finite: at 100,000 km residual focus-extension error is < 2e-8 mm
  // even for the custom 1200 mm lens. Raster DOF uses the exact infinity limit.
  camera.focusDistance = lens.focusM === Infinity ? 1e8 : lens.focusM;
  camera.bokehSize = dof ? lens.focalMm / lens.aperture : 0;
  camera.apertureBlades = lens.blades;
}

export class PathTracingPreview {
  private readonly tracer!: WebGLPathTracer;
  private readonly physicalWorld: ReturnType<typeof createPathTracingScene>;
  private readonly camera = new PhysicalCamera();
  private readonly denoiser = new PathTracingDenoiser();
  private filteredTexture: THREE.Texture | null = null;
  private filteredSamples = 0;
  constructor(private readonly renderer: THREE.WebGLRenderer, world: SceneInstance, source: THREE.PerspectiveCamera) {
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('设备不支持光追所需的浮点渲染');
    this.physicalWorld = createPathTracingScene(world);
    try {
    this.tracer = new WebGLPathTracer(renderer);
    installTracerSolarBackground(this.tracer, this.physicalWorld.solar);
    this.tracer.textureSize.set(256, 256);
    this.tracer.bounces = 6;
    this.tracer.transmissiveBounces = 8;
    this.tracer.filterGlossyFactor = 0.75;
    this.tracer.multipleImportanceSampling = true;
    this.tracer.tiles.set(2, 2);
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 1;
    this.tracer.fadeDuration = 0;
    this.tracer.rasterizeScene = false;
    this.tracer.renderToCanvas = false;
    configurePhysicalCamera(this.camera, source, { focalMm: 50, aperture: 1.8, focusM: 2.4, blades: 9 }, false, 24);
    this.tracer.setScene(this.physicalWorld.scene, this.camera);
    } catch (error) { this.tracer?.dispose(); this.denoiser.dispose(); this.physicalWorld.dispose(); throw error; }
  }
  update(source: THREE.PerspectiveCamera, lens: { focalMm: number; aperture: number; focusM: number; blades: number }, dof: boolean, sensorHeight: number) {
    configurePhysicalCamera(this.camera, source, lens, dof, sensorHeight);
    // The renderer drawing buffer already applies the selected quality percentage.
    this.tracer.renderScale = 1;
    this.tracer.updateCamera();
    this.tracer.reset();
    this.filteredTexture = null;
    this.filteredSamples = 0;
  }
  render(depth: THREE.Texture, guide: THREE.Texture) {
    if (this.physicalWorld.syncSun()) {
      this.tracer.updateLights();
      this.filteredTexture = null; this.filteredSamples = 0;
    }
    this.tracer.renderSample();
    const samples = Math.floor(this.tracer.samples);
    // Publish complete samples so the filter never mixes updated and stale tiles.
    if (samples > this.filteredSamples) {
      this.filteredTexture = this.denoiser.render(this.renderer, this.tracer.target, depth, guide, this.camera, samples);
      this.filteredSamples = samples;
    }
    return { samples, texture: this.filteredTexture };
  }
  dispose() { this.tracer.dispose(); this.denoiser.dispose(); this.physicalWorld.dispose(); }
}
