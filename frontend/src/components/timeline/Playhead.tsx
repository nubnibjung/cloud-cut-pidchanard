import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import { msToPixels, pixelsToMs } from '../../utils/timecode';

export function Playhead() {
  const currentTimeMs = usePlaybackStore((state) => state.currentTimeMs);
  const seek = usePlaybackStore((state) => state.seek);
  const zoomLevel = useUIStore((state) => state.zoomLevel);
  return (
    <div
      className="absolute bottom-0 top-0 z-20 w-0.5 cursor-ew-resize bg-accent touch-none"
      style={{ left: 120 + msToPixels(currentTimeMs, zoomLevel) }}
      onPointerDown={(event) => {
        const startX = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        const move = (moveEvent: PointerEvent) => seek(pixelsToMs(moveEvent.clientX - startX - 120, zoomLevel));
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
      }}
    />
  );
}
