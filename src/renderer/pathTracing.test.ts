import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { PathTracingPreview } from './pathTracing';

vi.mock('three-gpu-pathtracer', async importOriginal => {
  const original = await importOriginal<typeof import('three-gpu-pathtracer')>();
  return {
    ...original,
    WebGLPathTracer: vi.fn(class {
      textureSize = new THREE.Vector2();
      tiles = new THREE.Vector2();
      renderScale = 1;
      setScene = vi.fn();
      updateCamera = vi.fn();
      reset = vi.fn();
      dispose = vi.fn();
    }),
  };
});

describe('path tracing quality', () => {
  it('switches between full, balanced and low resolution and resets accumulation', () => {
    const renderer = { extensions: { has: () => true } } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(30, 1.5, 0.08, 80);
    const preview = new PathTracingPreview(renderer, {
      scene: new THREE.Scene(),
      sunlight: { sun: new THREE.DirectionalLight(), density: 0, distance: 20, groundHeight: 0, heightFalloff: 0 },
      dispose() {},
    }, camera);
    const tracer = vi.mocked(WebGLPathTracer).mock.instances[0];
    const lens = { focalMm: 50, aperture: 1.8, focusM: 2.4, blades: 9 };
    try {
      for (const [quality, scale] of [
        ['balanced', 0.7], ['high', 1], ['low', 0.45], ['high', 1], ['balanced', 0.7],
      ] as const) {
        vi.mocked(tracer.reset).mockClear();
        vi.mocked(tracer.updateCamera).mockClear();
        preview.update(camera, lens, true, quality, 24);
        expect(tracer.renderScale).toBe(scale);
        expect(tracer.updateCamera).toHaveBeenCalledOnce();
        expect(tracer.reset).toHaveBeenCalledOnce();
      }
    } finally {
      preview.dispose();
    }
  });
});
