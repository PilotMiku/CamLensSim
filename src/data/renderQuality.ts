import type { RenderQuality } from '../domain/types';

export const RENDER_QUALITY_ORDER: readonly RenderQuality[] = ['fine', 'balanced', 'performance', 'smooth'];

export const RENDER_QUALITY: Record<RenderQuality, {
  label: string;
  resolutionScale: number;
  dofSamples: number;
  volumeSteps: number;
  msaa: number;
}> = {
  fine: { label: '精细', resolutionScale: 1, dofSamples: 64, volumeSteps: 64, msaa: 4 },
  balanced: { label: '均衡', resolutionScale: 0.85, dofSamples: 44, volumeSteps: 64, msaa: 4 },
  performance: { label: '性能', resolutionScale: 0.7, dofSamples: 28, volumeSteps: 48, msaa: 0 },
  smooth: { label: '流畅', resolutionScale: 0.5, dofSamples: 14, volumeSteps: 32, msaa: 0 },
};

/** Each percentage scales width and height relative to the native canvas size, once. */
export function qualityPixelRatio(quality: RenderQuality, devicePixelRatio: number): number {
  const nativeRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return nativeRatio * RENDER_QUALITY[quality].resolutionScale;
}
