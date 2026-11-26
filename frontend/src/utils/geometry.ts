import type { Clip } from '../types';

export interface SnapResult {
  timeMs: number;
  snapped: boolean;
  guideMs?: number;
}

const endOf = (clip: Clip) => clip.track_position_ms + clip.duration_ms;

/** How far a clip may be trimmed outwards before it would touch a neighbour on its track. */
export function trimLimits(clip: Clip, clips: Clip[]): { minStartMs: number; maxEndMs: number } {
  let minStartMs = 0;
  let maxEndMs = Number.POSITIVE_INFINITY;
  for (const other of clips) {
    if (other.id === clip.id || other.track_id !== clip.track_id) continue;
    if (other.track_position_ms < clip.track_position_ms) minStartMs = Math.max(minStartMs, Math.min(endOf(other), clip.track_position_ms));
    else maxEndMs = Math.min(maxEndMs, Math.max(other.track_position_ms, endOf(clip)));
  }
  return { minStartMs, maxEndMs };
}

/**
 * Where a clip of `durationMs` can sit when dropped at `startMs` among `others`
 * (the other clips of the target track). Returns `startMs` when it is free, the
 * nearest free position next to a clip otherwise, or null when nothing fits.
 */
export function resolveOverlap(startMs: number, durationMs: number, others: Clip[]): number | null {
  const fits = (start: number) =>
    start >= 0 && others.every((other) => start + durationMs <= other.track_position_ms || start >= endOf(other));
  if (fits(startMs)) return startMs;

  const candidates = others
    .flatMap((other) => [endOf(other), other.track_position_ms - durationMs])
    .filter(fits)
    .sort((a, b) => Math.abs(a - startMs) - Math.abs(b - startMs));
  return candidates.length > 0 ? candidates[0] : null;
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
