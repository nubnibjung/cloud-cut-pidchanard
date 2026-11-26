import { describe, expect, it } from 'vitest';
import type { Clip } from '../src/types';
import { resolveOverlap, trimLimits } from '../src/utils/geometry';

function clip(id: string, startMs: number, durationMs: number, trackId = 'v1'): Clip {
  return {
    id,
    project_id: 'p1',
    track_id: trackId,
    asset_id: 'a1',
    name: id,
    track_position_ms: startMs,
    in_point_ms: 0,
    out_point_ms: durationMs,
    duration_ms: durationMs,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    version: 1,
  };
}

describe('clip overlap', () => {
  const a = clip('a', 0, 12000);
  const b = clip('b', 14000, 20000);

  it('keeps a drop that lands in free space', () => {
    expect(resolveOverlap(40000, 5000, [a, b])).toBe(40000);
  });

  it('slides a drop off the clip it landed on', () => {
    // Dropped 1s into `b`: the nearest free spot is right after `b`... unless the gap before fits
    expect(resolveOverlap(15000, 2000, [a, b])).toBe(12000);
    expect(resolveOverlap(30000, 5000, [a, b])).toBe(34000);
  });

  it('never resolves to a position before time zero', () => {
    expect(resolveOverlap(0, 5000, [clip('x', 0, 1000)])).toBe(1000);
  });

  it('limits a trim to the neighbours on the same track', () => {
    expect(trimLimits(b, [a, b, clip('other-track', 0, 99999, 'v2')])).toEqual({ minStartMs: 12000, maxEndMs: Number.POSITIVE_INFINITY });
    expect(trimLimits(a, [a, b])).toEqual({ minStartMs: 0, maxEndMs: 14000 });
  });
});
