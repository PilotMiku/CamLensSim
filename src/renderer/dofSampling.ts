/** Fixed disk samples keep adjacent pixels coherent instead of rotating a noisy kernel per pixel. */
export function createDofDiskSamples(count: number): Array<{ x: number; y: number }> {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new RangeError('DOF samples must be 1–64');
  return Array.from({ length: 64 }, (_, i) => {
    if (i >= count) return { x: 0, y: 0 };
    // Mirror pairs so a straight edge through the kernel center has exactly 50% coverage.
    const pairs = Math.floor(count / 2);
    if (i === pairs * 2) return { x: Math.sqrt(0.5 / count), y: 0 };
    const fi = Math.floor(i / 2) + 0.5;
    const radius = Math.sqrt(fi / pairs), angle = fi * 2.39996323;
    const sign = i % 2 === 0 ? 1 : -1;
    return { x: sign * Math.cos(angle) * radius, y: sign * Math.sin(angle) * radius };
  });
}
