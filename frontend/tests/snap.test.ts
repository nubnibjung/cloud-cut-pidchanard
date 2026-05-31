import { describe, expect, it } from 'vitest';
import { snapTime } from '../src/utils/geometry';

describe('snap logic', () => {
  it('snaps near clip edge', () => {
    const result = snapTime(990, [{
      id: 'c1',
      project_id: 'p1',
      track_id: 'v1',
      asset_id: 'a1',
      name: 'Intro',
      track_position_ms: 1000,
      in_point_ms: 0,
      out_point_ms: 1000,
      duration_ms: 1000,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      version: 1
    }], 3000);
    expect(result).toEqual({ timeMs: 1000, snapped: true, guideMs: 1000 });
  });
});
