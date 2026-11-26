import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import { msToPixels, pixelsToMs } from '../../utils/timecode';

export function Playhead() {
  const currentTimeMs = usePlaybackStore((state) => state.currentTimeMs);
  const seek = usePlaybackStore((state) => state.seek);
  const zoomLevel = useUIStore((state) => state.zoomLevel);
  return (
    <div
      // 9px wide grab area around a 1px line
      className="group absolute bottom-0 top-0 z-20 -ml-1 w-[9px] cursor-ew-resize touch-none"
      style={{ left: 120 + msToPixels(currentTimeMs, zoomLevel) }}
      onPointerDown={(event) => {
        const startX = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        const move = (moveEvent: PointerEvent) => seek(pixelsToMs(moveEvent.clientX - startX - 120, zoomLevel));
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
      }}
    >
      <div className="absolute left-0 top-0 h-2.5 w-[9px] rounded-b-sm bg-accent transition-transform group-hover:scale-110" />
      <div className="absolute bottom-0 left-1 top-0 w-px bg-accent" />
    </div>
  );
}
