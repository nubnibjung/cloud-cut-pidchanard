import type { Clip } from '../types';

export interface SnapResult {
  timeMs: number;
  snapped: boolean;
  guideMs?: number;
}

export function snapTime(timeMs: number, clips: Clip[], playheadMs: number, thresholdMs = 120): SnapResult {
  const candidates = [playheadMs, ...clips.flatMap((clip) => [clip.track_position_ms, clip.track_position_ms + clip.duration_ms])];
  const nearest = candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - timeMs);
    return distance < best.distance ? { candidate, distance } : best;
  }, { candidate: timeMs, distance: Number.POSITIVE_INFINITY });
  if (nearest.distance <= thresholdMs) {
    return { timeMs: nearest.candidate, snapped: true, guideMs: nearest.candidate };
  }
  return { timeMs, snapped: false };
}
