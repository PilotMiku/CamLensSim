import { patchSolarShadow } from './solarShadow';
import { sensorNoiseCoefficients } from '../optics/sensorNoise';
import { sensorNoiseShader } from './sensorNoiseShader';
import type { PathTracingPreview } from './pathTracing';
import { createSunlightMaterial, sunlightComposite } from './sunlight';
import * as THREE from 'three';
import { createDofDiskSamples } from './dofSampling';
import { RENDER_QUALITY, RENDER_QUALITY_ORDER, qualityPixelRatio } from '../data/renderQuality';
import { clamp } from '../domain/camera';
import type {
  CameraParameters,
  LensPreset,
  SensorPreset,
  Vec3,
  ViewSettings,
  RenderQuality,
} from '../domain/types';
import { exposureScale, exposureValue, workingFovDeg, tiltFocusModel } from '../optics/calculate';
import type { SceneDefinition, SceneInstance } from '../scenes/types';
import {
  bokehShader,
  nearRadiusShader,
  foregroundShader,
  cocShader,
  compositeShader,
  downsampleShader,
} from './depthOfField';

export type RendererStatus = 'loading' | 'ready' | 'lost' | 'unavailable';

export interface FocusHit {
  distanceM: number;
  point: Vec3;
}

const DEG = Math.PI / 180;
const BASE_EXPOSURE = 0.85;
const DOF_DISK_SAMPLES = Object.fromEntries(RENDER_QUALITY_ORDER.map(quality => [quality,
  createDofDiskSamples(RENDER_QUALITY[quality].dofSamples).map(p => new THREE.Vector2(p.x, p.y)),
])) as Record<RenderQuality, THREE.Vector2[]>;

/**
 * Equisolid fisheye projection injected into every scene material's vertex
 * shader. When disabled it falls back to the ordinary perspective matrix, and
 * fisheye depth encodes radial distance with the same near/far encoding as axial
 * perspective depth, so downstream DOF can reconstruct it without a sign change.
 */
const FISHEYE_PROJECT_VERTEX = /* glsl */ `
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  vFisheyeViewPosition = mvPosition.xyz;
  if (uFisheye) {
    float viewDepth = max(length(mvPosition.xyz), 0.001);
    vec3 dir = normalize(mvPosition.xyz);
    float theta = acos(clamp(-dir.z, -1.0, 1.0));
    float r = 2.0 * uFocalMm * sin(theta * 0.5);
    vec2 radial = dir.xy / max(length(dir.xy), 1e-6);
    float d = uFar * (viewDepth - uNear) / (viewDepth * (uFar - uNear));
    // Spherical clipping is done per fragment, including triangles crossing a
    // radial near/far boundary. Do not clip the rear hemisphere as perspective z.
    float ndcZ = clamp(d, 0.000001, 0.999999) * 2.0 - 1.0;
    gl_Position = vec4(radial * (r / uHalfSensorMm), ndcZ, 1.0);
  } else {
    gl_Position = projectionMatrix * mvPosition;
  }
`;

interface LensUniforms {
  focalMm: number;
  aperture: number;
  focusM: number;
  sensorWidthMm: number;
  diffractionMm: number;
  blades: number;
  tiltRad: number;
  shiftY: number;
  fisheye: boolean;
  annular: boolean;
}

export class SimulatorRenderer {
  private pathPreview: PathTracingPreview | null = null;
  private traceRequested = false;
  private traceSupported = true;
  private tracePreparing = false;
  private traceFailed = false;
  private traceDirty = true;
  private traceGeneration = 0;
  private lastTraceUpdate = 0;
  private traceSignature = '';
  private reportedTraceStatus = '';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(30, 1.5, 0.08, 80);
  private readonly world: SceneInstance;
  private readonly observer: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly quad: THREE.Mesh;
  private readonly downsampleMaterial: THREE.ShaderMaterial;
  private readonly cocMaterial: THREE.ShaderMaterial;
  private readonly nearRadiusMaterial: THREE.ShaderMaterial;
  private readonly foregroundMaterial: THREE.ShaderMaterial;
  private readonly bokehMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly traceCompositeMaterial: THREE.ShaderMaterial;

  private readonly sunlightMaterial: THREE.ShaderMaterial | null;
  private sunlightTarget: THREE.WebGLRenderTarget | null = null;

  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private halfColorTarget: THREE.WebGLRenderTarget | null = null;
  private cocTarget: THREE.WebGLRenderTarget | null = null;
  private nearRadiusXTarget: THREE.WebGLRenderTarget | null = null;
  private nearRadiusTarget: THREE.WebGLRenderTarget | null = null;
  private foregroundTarget: THREE.WebGLRenderTarget | null = null;
  private blurTarget: THREE.WebGLRenderTarget | null = null;

  private bufferWidth = 1;
  private bufferHeight = 1;
  private halfWidth = 1;
  private halfHeight = 1;
  private pixelRatio = 1;
  private quality: ViewSettings['quality'] = 'balanced';
  private targetSamples = 4;
  private dofEnabled = true;
  private noise = sensorNoiseCoefficients({ aperture: 1.8, shutterSeconds: 1 / 125, iso: 100 }, { widthMm: 36, heightMm: 24 });
  private noiseSeed = 17;
  private noiseSignature = '';
  private frame = 0;
  private disposed = false;
  private lost = false;

  private vFovRad = 30 * DEG;
  private aspect = 1.5;
  private sensor: SensorPreset | null = null;
  private readonly fisheyeUniforms: Array<Record<string, THREE.IUniform>> = [];
  private readonly fisheyeCulling = new WeakMap<THREE.Object3D, boolean>();
  private readonly fisheyePatched = new Set<THREE.Material>();

  private lens: LensUniforms = {
    focalMm: 50,
    aperture: 1.8,
    focusM: 2.4,
    sensorWidthMm: 36,
    diffractionMm: 0.02,
    blades: 9,
    tiltRad: 0,
    shiftY: 0,
    fisheye: false,
    annular: false,
  };

  constructor(
    private readonly host: HTMLElement,
    definition: SceneDefinition,
    private readonly onStatus: (status: RendererStatus) => void,
    private readonly onTraceStatus: (message: string) => void = () => {},
  ) {
    this.camera.near = definition.cameraNear;
    this.camera.far = definition.cameraFar;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = BASE_EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '实时三维画面，点击物体对焦，拖动环视',
    );
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    host.appendChild(this.renderer.domElement);

    this.world = definition.create({ renderer: this.renderer });
    this.world.setQuality?.(this.quality);
    this.attachFisheyeProjection();
    this.sunlightMaterial = this.world.sunlight ? createSunlightMaterial(this.world.sunlight) : null;

    const postMaterial = (
      shader: { vertexShader: string; fragmentShader: string },
      uniforms: Record<string, THREE.IUniform>,
      toneMapped = false,
    ) =>
      new THREE.ShaderMaterial({
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped,
      });

    this.downsampleMaterial = postMaterial(downsampleShader, {
      tColor: { value: null },
      tDepth: { value: null }, nearPlane: { value: this.camera.near }, farPlane: { value: this.camera.far },
      texel: { value: new THREE.Vector2() },
    });
    this.cocMaterial = postMaterial(cocShader, {
      tDepth: { value: null },
      texel: { value: new THREE.Vector2() },
      nearPlane: { value: this.camera.near },
      farPlane: { value: this.camera.far },
      focalMm: { value: 50 },
      aperture: { value: 1.8 },
      inverseFocusM: { value: 1 / 2.4 },
      sensorWidthMm: { value: 36 },
      diffractionMm: { value: 0.02 },
      fullWidthPx: { value: 1 },
      focusGradientPerM: { value: 0 },
      imageDistanceMm: { value: 50 },
      shiftY: { value: 0 },
      vFovRad: { value: this.vFovRad },
      aspect: { value: 1.5 },
    });
    this.bokehMaterial = postMaterial(bokehShader, {
      tHalfColor: { value: null },
      tCoc: { value: null },
      halfTexel: { value: new THREE.Vector2() },
      maxRadius: { value: 40 },
      sampleCount: { value: 44 },
      diskSamples: { value: DOF_DISK_SAMPLES.balanced },
      blades: { value: 9 },
      annular: { value: 0 },
    });
    this.nearRadiusMaterial = postMaterial(nearRadiusShader, {
      tInput: { value: null }, direction: { value: new THREE.Vector2() },
      radiusLimit: { value: 28 }, fromCoc: { value: true },
    });
    this.foregroundMaterial = postMaterial(foregroundShader, {
      tHalfColor: { value: null }, tCoc: { value: null }, tNearRadius: { value: null },
      halfTexel: { value: new THREE.Vector2() }, maxRadius: { value: 40 },
      sampleCount: { value: 44 },
      diskSamples: { value: DOF_DISK_SAMPLES.balanced }, blades: { value: 9 }, annular: { value: 0 },
    });
    this.compositeMaterial = postMaterial(compositeShader, {
      tColor: { value: null },
      tBlur: { value: null },
      tForeground: { value: null }, tCoc: { value: null }, halfSize: { value: new THREE.Vector2(1, 1) },
      tDepth: { value: null },
      resolution: { value: new THREE.Vector2() },
      nearPlane: { value: this.camera.near },
      farPlane: { value: this.camera.far },
      focalMm: { value: 50 },
      aperture: { value: 1.8 },
      inverseFocusM: { value: 1 / 2.4 },
      sensorWidthMm: { value: 36 },
      diffractionMm: { value: 0.02 },
      fullWidthPx: { value: 1 },
      dofEnabled: { value: true },
      vignetteAmount: { value: 0.16 },

      focusGradientPerM: { value: 0 },
      imageDistanceMm: { value: 50 },
      shiftY: { value: 0 },
      vFovRad: { value: this.vFovRad },
      aspect: { value: 1.5 },
    }, true);

    this.traceCompositeMaterial = postMaterial({
      vertexShader: compositeShader.vertexShader,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tColor;
        ${sunlightComposite}
        ${sensorNoiseShader}
        void main() {
          gl_FragColor = vec4(applySensorNoise(litColor(vUv), vUv), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }, { tColor: { value: null } }, true);

    for (const material of [this.downsampleMaterial, this.compositeMaterial, this.traceCompositeMaterial]) {
      Object.assign(material.uniforms, {
        tSunlight: { value: null }, tSunDepth: { value: null },
        sunlightEnabled: { value: false }, sunlightSize: { value: new THREE.Vector2(1, 1) },
        sunlightPlanes: { value: new THREE.Vector2(this.camera.near, this.camera.far) },
      });
    }
    for (const material of [this.compositeMaterial, this.traceCompositeMaterial]) {
      Object.assign(material.uniforms, {
        noiseResolution: { value: new THREE.Vector2(1, 1) }, noiseSeed: { value: this.noiseSeed },
        shotVariance: { value: this.noise.shotVariance }, readVariance: { value: this.noise.readVariance },
      });
    }
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
  }

  update(
    parameters: CameraParameters,
    sensor: SensorPreset,
    lensPreset: LensPreset,
    view: ViewSettings,
  ) {
    this.sensor = sensor;
    const pose = parameters.pose;
    this.aspect = sensor.widthMm / sensor.heightMm;
    const isFisheye = lensPreset.kind === 'fisheye';
    if (isFisheye !== this.lens.fisheye) {
      for (const material of this.fisheyePatched) material.needsUpdate = true;
    }
    this.camera.userData.solarProjection = isFisheye
      ? { focalMm: parameters.focalLengthMm, widthMm: sensor.widthMm, heightMm: sensor.heightMm } : null;
    let fovDeg = 30;
    if (!isFisheye) {
      try {
        fovDeg = workingFovDeg(sensor.heightMm, parameters.focalLengthMm, parameters.focusDistanceM, parameters.tiltDeg);
      } catch {
        fovDeg = 30;
      }
    }
    this.vFovRad = fovDeg * DEG;

    this.camera.fov = (this.vFovRad * 180) / Math.PI;
    this.camera.aspect = this.aspect;
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(pose.pitchDeg * DEG, pose.yawDeg * DEG, 0);
    this.camera.updateMatrixWorld();

    // Oblique (lens-shift) frustum built by hand, falling back to the standard
    // perspective when shift is zero.
    const near = this.camera.near;
    const far = this.camera.far;
    const top = near * Math.tan(this.vFovRad / 2);
    const bottom = -top;
    const right = top * this.aspect;
    const left = -right;
    const shiftX = parameters.shiftX * right;
    const shiftY = parameters.shiftY * top;
    const projection = new THREE.Matrix4().makePerspective(
      left + shiftX,
      right + shiftX,
      top + shiftY,
      bottom + shiftY,
      near,
      far,
    );
    this.camera.projectionMatrix.copy(projection);
    this.camera.projectionMatrixInverse.copy(projection).invert();

    // The ordinary 30-degree perspective frustum cannot cull a fisheye image.
    this.world.scene.traverse((object) => {
      const original = this.fisheyeCulling.get(object);
      if (isFisheye) {
        if (original === undefined) this.fisheyeCulling.set(object, object.frustumCulled);
        object.frustumCulled = false;
      } else if (original !== undefined) {
        object.frustumCulled = original;
        this.fisheyeCulling.delete(object);
      }
    });

    this.lens = {
      focalMm: parameters.focalLengthMm,
      aperture: parameters.aperture,
      focusM: parameters.focusDistanceM,
      sensorWidthMm: sensor.widthMm,
      diffractionMm: 2.44 * 0.00055 * parameters.aperture,
      blades: lensPreset.blades,
      tiltRad: (parameters.tiltDeg * Math.PI) / 180,
      shiftY: parameters.shiftY,
      fisheye: isFisheye,
      annular: lensPreset.kind === 'mirror',
    };

    const ev100 = exposureValue(parameters.aperture, parameters.shutterSeconds, parameters.iso);
    const relativeExposure = exposureScale(ev100);
    this.renderer.toneMappingExposure =
      BASE_EXPOSURE * (parameters.constantExposure ? 1 : relativeExposure);

    this.dofEnabled = view.depthOfField;
    if (this.quality !== view.quality) this.world.setQuality?.(view.quality);
    this.quality = view.quality;
    this.noise = sensorNoiseCoefficients(parameters, sensor);
    // One sensor realization per parameter/camera change, held through path convergence.
    const noiseSignature = JSON.stringify([parameters.pose, parameters.focalLengthMm, parameters.aperture,
      parameters.shutterSeconds, parameters.iso, parameters.focusDistanceM, parameters.tiltDeg,
      parameters.shiftX, parameters.shiftY, sensor.widthMm, sensor.heightMm]);
    if (noiseSignature !== this.noiseSignature) {
      this.noiseSignature = noiseSignature;
      this.noiseSeed = (this.noiseSeed + 1) % 4096;
    }
    const nextRatio = qualityPixelRatio(view.quality, window.devicePixelRatio);
    const nextSamples = RENDER_QUALITY[view.quality].msaa;
    if (nextRatio !== this.pixelRatio || nextSamples !== this.targetSamples) {
      this.pixelRatio = nextRatio;
      this.targetSamples = nextSamples;
      this.resize();
    }
    this.updateUniforms(view);
    if (view.renderMode === 'pathtraced' && !this.traceRequested) this.traceFailed = false;
    this.traceRequested = view.renderMode === 'pathtraced';
    this.traceSupported = !isFisheye && lensPreset.kind !== 'mirror' && Math.abs(parameters.tiltDeg) < 0.001;
    const traceSignature = JSON.stringify([this.camera.matrixWorld.elements, this.camera.projectionMatrix.elements,
      // Exposure is applied only in the output pass; it must not reset radiance accumulation.
      this.lens, this.dofEnabled, this.quality]);
    if (traceSignature !== this.traceSignature) {
      this.traceSignature = traceSignature;
      this.traceDirty = true;
      this.lastTraceUpdate = performance.now();
    }
    if (!this.traceRequested) this.reportTrace('');
    else if (!this.traceSupported) this.reportTrace('当前镜头使用实时预览，光追支持普通透视与平移镜头');
    else if (!this.traceFailed) void this.preparePathTracing();
    this.invalidate();
  }

  focusAt(clientX: number, clientY: number): FocusHit | null {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !this.sensor) return null;
    let ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (this.lens.fisheye) {
      this.setFisheyeRay(ndc);
    } else {
      this.raycaster.setFromCamera(ndc, this.camera);
      const forwardCosine = -this.raycaster.ray.direction.clone().transformDirection(this.camera.matrixWorldInverse).z;
      this.raycaster.near = this.camera.near / forwardCosine;
      this.raycaster.far = this.camera.far / forwardCosine;
    }
    const hit = this.raycaster.intersectObjects(this.world.scene.children, true)[0];
    if (!hit) return null;
    const viewPoint = hit.point.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const distanceM = this.lens.fisheye ? hit.distance : -viewPoint.z;
    if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
    return {
      distanceM,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    };
  }

  private updateUniforms(view: ViewSettings) {
    if (!this.sceneTarget) return;
    const fullWidth = this.bufferWidth;
    const fullHeight = this.bufferHeight;
    const maxRadius = clamp(Math.round(fullWidth * 0.034), 14, 56);
    const sampleCount = RENDER_QUALITY[view.quality].dofSamples;
    const lens = this.lens;
    const focusModel = tiltFocusModel(lens.focalMm, lens.focusM, lens.tiltRad / DEG);

    const downsample = this.downsampleMaterial.uniforms;
    downsample.tColor.value = this.sceneTarget.texture;
    downsample.tDepth.value = this.sceneTarget.depthTexture;
    downsample.nearPlane.value = this.camera.near;
    downsample.farPlane.value = this.camera.far;
    downsample.texel.value.set(1 / fullWidth, 1 / fullHeight);

    const coc = this.cocMaterial.uniforms;
    coc.tDepth.value = this.sceneTarget.depthTexture;
    coc.texel.value.set(1 / fullWidth, 1 / fullHeight);
    coc.nearPlane.value = this.camera.near;
    coc.farPlane.value = this.camera.far;
    coc.focalMm.value = lens.focalMm;
    coc.aperture.value = lens.aperture;
    coc.inverseFocusM.value = 1 / lens.focusM;
    coc.sensorWidthMm.value = lens.sensorWidthMm;
    coc.diffractionMm.value = lens.diffractionMm;
    coc.fullWidthPx.value = fullWidth;
    coc.focusGradientPerM.value = focusModel.gradientPerM;
    coc.imageDistanceMm.value = focusModel.imageDistanceMm;
    coc.shiftY.value = lens.shiftY;
    coc.vFovRad.value = this.vFovRad;
    coc.aspect.value = this.aspect;

    for (const uniforms of this.fisheyeUniforms) {
      uniforms.uFisheye.value = lens.fisheye;
      uniforms.uFocalMm.value = lens.focalMm;
      uniforms.uHalfSensorMm.value.set(
        (this.sensor?.widthMm ?? 36) / 2,
        (this.sensor?.heightMm ?? 24) / 2,
      );
      uniforms.uNear.value = this.camera.near;
      uniforms.uFar.value = this.camera.far;
    }

    const bokeh = this.bokehMaterial.uniforms;
    bokeh.tHalfColor.value = this.halfColorTarget?.texture ?? null;
    bokeh.tCoc.value = this.cocTarget?.texture ?? null;
    bokeh.halfTexel.value.set(1 / this.halfWidth, 1 / this.halfHeight);
    bokeh.maxRadius.value = maxRadius;
    bokeh.sampleCount.value = sampleCount;
    bokeh.diskSamples.value = DOF_DISK_SAMPLES[view.quality];
    bokeh.blades.value = lens.blades;
    bokeh.annular.value = lens.annular ? 1 : 0;

    const foreground = this.foregroundMaterial.uniforms;
    foreground.tHalfColor.value = this.halfColorTarget?.texture ?? null;
    foreground.tCoc.value = this.cocTarget?.texture ?? null;
    foreground.tNearRadius.value = this.nearRadiusTarget?.texture ?? null;
    foreground.halfTexel.value.set(1 / this.halfWidth, 1 / this.halfHeight);
    foreground.maxRadius.value = maxRadius;
    foreground.sampleCount.value = sampleCount;
    foreground.diskSamples.value = DOF_DISK_SAMPLES[view.quality];
    foreground.blades.value = lens.blades;
    foreground.annular.value = lens.annular ? 1 : 0;
    this.nearRadiusMaterial.uniforms.radiusLimit.value = maxRadius * 0.5;

    const composite = this.compositeMaterial.uniforms;
    composite.tColor.value = this.sceneTarget.texture;
    composite.tBlur.value = this.blurTarget?.texture ?? null;
    composite.tForeground.value = this.foregroundTarget?.texture ?? null;
    composite.tCoc.value = this.cocTarget?.texture ?? null;
    composite.halfSize.value.set(this.halfWidth, this.halfHeight);
    composite.tDepth.value = this.sceneTarget.depthTexture;
    composite.resolution.value.set(fullWidth, fullHeight);
    composite.nearPlane.value = this.camera.near;
    composite.farPlane.value = this.camera.far;
    composite.focalMm.value = lens.focalMm;
    composite.aperture.value = lens.aperture;
    composite.inverseFocusM.value = 1 / lens.focusM;
    composite.sensorWidthMm.value = lens.sensorWidthMm;
    composite.diffractionMm.value = lens.diffractionMm;
    composite.fullWidthPx.value = fullWidth;
    composite.dofEnabled.value = view.depthOfField;
    composite.focusGradientPerM.value = focusModel.gradientPerM;
    composite.imageDistanceMm.value = focusModel.imageDistanceMm;
    composite.shiftY.value = lens.shiftY;
    composite.vFovRad.value = this.vFovRad;
    composite.aspect.value = this.aspect;
    const extraVignette = lens.fisheye ? 0.18 : lens.annular ? 0.1 : 0;
    composite.vignetteAmount.value =
      0.05 +
      0.13 *
        clamp(1.8 / lens.aperture, 0.15, 1.1) *
        clamp(1 + (50 - lens.focalMm) / 150, 0.75, 1.25) +
      extraVignette;
    for (const material of [this.compositeMaterial, this.traceCompositeMaterial]) {
      material.uniforms.noiseResolution.value.set(fullWidth, fullHeight);
      material.uniforms.noiseSeed.value = this.noiseSeed;
      material.uniforms.shotVariance.value = this.noise.shotVariance;
      material.uniforms.readVariance.value = this.noise.readVariance;
    }
  }

  private readonly resize = () => {
    if (this.disposed || this.lost) return;
    const width = Math.max(1, Math.round(this.host.clientWidth));
    const height = Math.max(1, Math.round(this.host.clientHeight));
    this.pixelRatio = qualityPixelRatio(this.quality, window.devicePixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const bufferWidth = Math.max(1, Math.floor(size.x));
    const bufferHeight = Math.max(1, Math.floor(size.y));
    if (bufferWidth !== this.bufferWidth || bufferHeight !== this.bufferHeight || !this.sceneTarget
      || this.sceneTarget.samples !== this.targetSamples) {
      this.bufferWidth = bufferWidth;
      this.bufferHeight = bufferHeight;
      this.rebuildTargets(bufferWidth, bufferHeight);
    }
    this.host.dataset.resolutionScale = String(RENDER_QUALITY[this.quality].resolutionScale);
    this.traceDirty = true;
    this.updateUniforms({
      focusSound: false,
      renderMode: this.traceRequested ? 'pathtraced' : 'realtime',
      grid: false,
      depthOfField: this.dofEnabled,
      quality: this.quality,
      touchControls: false,
    });
    this.invalidate();
  };

  private rebuildTargets(width: number, height: number) {
    this.disposeTargets();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture,
      samples: this.targetSamples,
    });
    this.halfWidth = Math.max(1, Math.ceil(width / 2));
    this.halfHeight = Math.max(1, Math.ceil(height / 2));
    const half = { type: THREE.HalfFloatType, depthBuffer: false };
    this.halfColorTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    this.cocTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    this.blurTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    this.nearRadiusXTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    this.nearRadiusTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    this.foregroundTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    // Interpolating opposite CoC signs would erase the foreground at silhouettes.
    for (const target of [this.cocTarget, this.nearRadiusXTarget, this.nearRadiusTarget]) {
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    }
    if (this.sunlightMaterial) {
      this.sunlightTarget = new THREE.WebGLRenderTarget(this.halfWidth, this.halfHeight, half);
    }
    this.renderer.setRenderTarget(this.blurTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  private disposeTargets() {
    this.sunlightTarget?.dispose();
    this.sunlightTarget = null;
    this.sceneTarget?.dispose();
    this.halfColorTarget?.dispose();
    this.cocTarget?.dispose();
    this.blurTarget?.dispose();
    this.nearRadiusXTarget?.dispose(); this.nearRadiusTarget?.dispose(); this.foregroundTarget?.dispose();
    this.nearRadiusXTarget = null; this.nearRadiusTarget = null; this.foregroundTarget = null;
    this.sceneTarget = null;
    this.halfColorTarget = null;
    this.cocTarget = null;
    this.blurTarget = null;
  }

  private invalidate() {
    if (this.frame || this.disposed || this.lost) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed || this.lost || !this.sceneTarget) return;
      this.renderFrame();
    });
  }

  private renderFrame() {
    const sceneTarget = this.sceneTarget;
    if (!sceneTarget) return;
    if (this.traceRequested && this.traceSupported && this.pathPreview && performance.now() - this.lastTraceUpdate > 250) {
      try {
        if (this.traceDirty) {
          this.pathPreview.update(this.camera, this.lens, this.dofEnabled, this.sensor?.heightMm ?? 24);
          // A completed reset, rather than stale sample counts from the previous
          // camera/quality configuration, identifies each accumulation cycle.
          this.host.dataset.pathGeneration = String(++this.traceGeneration);
          // Cache depth, surface color and fixed-light shadows once per camera change.
          this.renderer.setRenderTarget(sceneTarget);
          this.renderer.render(this.world.scene, this.camera);
          this.renderSunlight();
          this.traceDirty = false;
        }
        this.renderer.setRenderTarget(null);
        const { samples, texture } = this.pathPreview.render(sceneTarget.depthTexture!, sceneTarget.texture);
        this.traceCompositeMaterial.uniforms.tColor.value = texture ?? sceneTarget.texture;
        this.quad.material = this.traceCompositeMaterial;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.quadScene, this.quadCamera);
        this.host.dataset.renderMode = 'pathtraced';
        this.host.dataset.pathSamples = String(samples);
        this.host.dataset.pathDenoised = String(!!texture);
        this.reportTrace(samples === 0 ? '光追准备中…' : `光追 · ${samples} / 128 次采样 · 已降噪${samples < 128 ? ' · 静止后逐步清晰' : ''}`);
        this.onStatus('ready');
        if (samples < 128) this.invalidate();
        return;
      } catch (error) {
        this.pathPreview.dispose(); this.pathPreview = null;
        this.traceFailed = true;
        this.reportTrace(`光追暂不可用，已使用实时预览：${error instanceof Error ? error.message : '设备不支持'}`);
      }
    }
    this.host.dataset.renderMode = 'realtime';
    this.host.dataset.pathSamples = '0';
    this.host.dataset.pathDenoised = 'false';
    this.renderer.setRenderTarget(sceneTarget);
    this.renderer.render(this.world.scene, this.camera);

    this.renderSunlight();
    if (this.dofEnabled) {
      this.quad.material = this.downsampleMaterial;
      this.renderer.setRenderTarget(this.halfColorTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.quad.material = this.cocMaterial;
      this.renderer.setRenderTarget(this.cocTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.quad.material = this.nearRadiusMaterial;
      const radiusUniforms = this.nearRadiusMaterial.uniforms;
      radiusUniforms.tInput.value = this.cocTarget!.texture;
      radiusUniforms.direction.value.set(1 / this.halfWidth, 0);
      radiusUniforms.fromCoc.value = true;
      this.renderer.setRenderTarget(this.nearRadiusXTarget);
      this.renderer.render(this.quadScene, this.quadCamera);
      radiusUniforms.tInput.value = this.nearRadiusXTarget!.texture;
      radiusUniforms.direction.value.set(0, 1 / this.halfHeight);
      radiusUniforms.fromCoc.value = false;
      this.renderer.setRenderTarget(this.nearRadiusTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.quad.material = this.foregroundMaterial;
      this.renderer.setRenderTarget(this.foregroundTarget);
      this.renderer.render(this.quadScene, this.quadCamera);

      this.quad.material = this.bokehMaterial;
      this.renderer.setRenderTarget(this.blurTarget);
      this.renderer.render(this.quadScene, this.quadCamera);
    }

    this.quad.material = this.compositeMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.onStatus('ready');
    if (this.traceRequested && this.traceSupported && this.pathPreview) this.invalidate();
  }

  private reportTrace(message: string) {
    if (this.reportedTraceStatus === message) return;
    this.reportedTraceStatus = message;
    this.onTraceStatus(message);
  }

  private async preparePathTracing() {
    if (this.pathPreview || this.tracePreparing || this.disposed) return;
    this.tracePreparing = true;
    this.reportTrace('准备光追场景…');
    try {
      const { PathTracingPreview } = await import('./pathTracing');
      if (this.disposed || !this.traceRequested || !this.traceSupported || this.lost) return;
      // Let the progress label paint before constructing the BVH and texture atlas.
      await new Promise(resolve => setTimeout(resolve, 30));
      if (this.disposed || !this.traceRequested || !this.traceSupported || this.lost) return;
      this.pathPreview = new PathTracingPreview(this.renderer, this.world, this.camera);
      this.traceDirty = true;
      this.invalidate();
    } catch (error) {
      if (!this.disposed) {
        this.traceFailed = true;
        this.reportTrace(`光追暂不可用，已使用实时预览：${error instanceof Error ? error.message : '设备不支持'}`);
      }
    } finally { this.tracePreparing = false; }
  }

  private renderSunlight() {
    const volume = this.world.sunlight;
    const material = this.sunlightMaterial;
    const shadow = volume?.sun.shadow;
    const enabled = !!(material && shadow?.map && this.sunlightTarget);
    if (enabled && material && volume && shadow) {
      const u = material.uniforms;
      u.tDepth.value = this.sceneTarget!.depthTexture;
      u.tShadow.value = shadow.map!.texture;
      u.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
      u.cameraWorld.value.copy(this.camera.matrixWorld);
      u.shadowMatrix.value.copy(shadow.matrix);
      u.sunDirection.value.copy(volume.sun.position).sub(volume.sun.target.position).normalize();
      u.sunColor.value.copy(volume.sun.color).multiplyScalar(volume.sun.visible ? volume.sun.intensity * 0.85 : 0);
      u.shadowTexel.value.set(1 / shadow.mapSize.x, 1 / shadow.mapSize.y);
      u.nearPlane.value = this.camera.near;
      u.farPlane.value = this.camera.far;
      u.steps.value = RENDER_QUALITY[this.quality].volumeSteps;
      const beam = volume.beam;
      u.beamEnabled.value = !!beam?.shadow.map;
      u.tBeamShadow.value = beam?.shadow.map?.texture ?? shadow.map!.texture;
      if (beam) {
        u.beamPosition.value.copy(beam.position);
        u.beamDirection.value.copy(beam.target.position).sub(beam.position).normalize();
        u.beamColor.value.copy(beam.color).multiplyScalar(beam.intensity);
        u.beamCone.value.set(Math.cos(beam.angle), Math.cos(beam.angle * (1 - beam.penumbra)));
        u.beamRange.value = beam.distance;
        u.beamShadowMatrix.value.copy(beam.shadow.matrix);
        u.beamShadowTexel.value.set(1 / beam.shadow.mapSize.x, 1 / beam.shadow.mapSize.y);
      }
      u.fisheye.value = this.lens.fisheye;
      u.focalMm.value = this.lens.focalMm;
      if (this.sensor) u.sensorSize.value.set(this.sensor.widthMm, this.sensor.heightMm);
      this.quad.material = material;
      this.renderer.setRenderTarget(this.sunlightTarget);
      this.renderer.render(this.quadScene, this.quadCamera);
    }
    this.host.dataset.volumetricLight = String(enabled);
    this.host.dataset.fixedLightBeam = String(enabled && !!volume?.beam?.shadow.map);
    for (const pass of [this.downsampleMaterial, this.compositeMaterial, this.traceCompositeMaterial]) {
      pass.uniforms.sunlightEnabled.value = enabled;
      pass.uniforms.tSunlight.value = this.sunlightTarget?.texture ?? this.sceneTarget!.texture;
      pass.uniforms.tSunDepth.value = this.sceneTarget!.depthTexture;
      pass.uniforms.sunlightSize.value.set(this.halfWidth, this.halfHeight);
    }
  }

  private attachFisheyeProjection() {
    this.world.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        if (this.fisheyePatched.has(item)) continue;
        this.fisheyePatched.add(item);
        const previousKey = item.customProgramCacheKey();
        item.customProgramCacheKey = () => `${previousKey}:equisolid-radial-depth-v2:${Number(this.lens.fisheye)}`;
        item.onBeforeCompile = (shader) => {
          patchSolarShadow(shader, this.world.sunlight.sun);
          shader.uniforms.uFisheye = { value: this.lens.fisheye };
          shader.uniforms.uFocalMm = { value: this.lens.focalMm };
          shader.uniforms.uHalfSensorMm = { value: new THREE.Vector2(
            (this.sensor?.widthMm ?? 36) / 2,
            (this.sensor?.heightMm ?? 24) / 2,
          ) };
          shader.uniforms.uNear = { value: this.camera.near };
          shader.uniforms.uFar = { value: this.camera.far };
          this.fisheyeUniforms.push(shader.uniforms);
          shader.vertexShader =
            'uniform bool uFisheye;\n' +
            'uniform float uFocalMm;\n' +
            'uniform vec2 uHalfSensorMm;\n' +
            'uniform float uNear;\n' +
            'uniform float uFar;\n' +
            'varying vec3 vFisheyeViewPosition;\n' +
            shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            FISHEYE_PROJECT_VERTEX,
          );
          shader.fragmentShader = /* glsl */ `
            #define SIMULATOR_FISHEYE_DEPTH ${Number(this.lens.fisheye)}
            uniform bool uFisheye;
            uniform float uNear, uFar;
            varying vec3 vFisheyeViewPosition;
          ` + shader.fragmentShader.replace('#include <logdepthbuf_fragment>', /* glsl */ `
            #include <logdepthbuf_fragment>
            // Ordinary lenses keep hardware early depth rejection. Only fish-
            // eye variants statically write depth or discard on radial bounds.
            #if SIMULATOR_FISHEYE_DEPTH
              float radialDepth = length(vFisheyeViewPosition);
              if (radialDepth < uNear || radialDepth > uFar) discard;
              gl_FragDepth = uFar * (radialDepth - uNear) / (radialDepth * (uFar - uNear));
            #endif
          `);
        };
      }
    });
  }

  private setFisheyeRay(ndc: THREE.Vector2) {
    if (!this.sensor) return;
    const halfW = this.sensor.widthMm / 2;
    const halfH = this.sensor.heightMm / 2;
    const pmm = { x: ndc.x * halfW, y: ndc.y * halfH };
    const r = Math.hypot(pmm.x, pmm.y);
    const ratio = Math.min(r / (2 * this.lens.focalMm), 1);
    const theta = 2 * Math.asin(ratio);
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const direction = new THREE.Vector3();
    if (r < 1e-6) direction.set(0, 0, -1);
    else direction.set((pmm.x / r) * sinT, (pmm.y / r) * sinT, -cosT);
    direction.applyQuaternion(this.camera.quaternion).normalize();
    this.raycaster.near = this.camera.near;
    this.raycaster.far = this.camera.far;
    this.raycaster.ray.origin.copy(this.camera.position);
    this.raycaster.ray.direction.copy(direction);
  }

  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.onStatus('lost');
  };

  private readonly contextRestored = () => {
    this.lost = false;
    this.pathPreview?.dispose(); this.pathPreview = null; this.traceFailed = false;
    if (this.traceRequested && this.traceSupported) void this.preparePathTracing();
    this.rebuildTargets(this.bufferWidth, this.bufferHeight);
    this.resize();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    this.pathPreview?.dispose();
    this.pathPreview = null;
    this.world.dispose();
    this.disposeTargets();
    this.downsampleMaterial.dispose();
    this.cocMaterial.dispose();
    this.bokehMaterial.dispose();
    this.nearRadiusMaterial.dispose(); this.foregroundMaterial.dispose();
    this.compositeMaterial.dispose();
    this.traceCompositeMaterial.dispose();
    this.sunlightMaterial?.dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
