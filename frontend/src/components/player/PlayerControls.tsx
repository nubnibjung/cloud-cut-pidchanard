import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { usePlaybackStore } from '../../state/playbackStore';
import { formatTimecode } from '../../utils/timecode';
import { IconButton } from '../ui/Button';
import { Slider } from '../ui/Input';

interface Props { totalMs?: number }

export function PlayerControls({ totalMs = 60000 }: Props) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const play = usePlaybackStore((s) => s.play);
  const pause = usePlaybackStore((s) => s.pause);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const seek = usePlaybackStore((s) => s.seek);
  const isMuted = usePlaybackStore((s) => s.isMuted);
  const toggleMute = usePlaybackStore((s) => s.toggleMute);
  const volume = usePlaybackStore((s) => s.volume);
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const max = Math.max(totalMs, 1000);
  const silent = isMuted || volume === 0;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border bg-panel px-3">
      <IconButton
        label={isPlaying ? 'Pause' : 'Play'}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        className="bg-ink/10 text-fg hover:bg-ink/15"
        onClick={() => (isPlaying ? pause() : play())}
      >
        {isPlaying ? <Pause aria-hidden className="h-4 w-4" /> : <Play aria-hidden className="h-4 w-4" />}
      </IconButton>

      <span className="shrink-0 text-xs tabular-nums text-fg">
        {formatTimecode(currentTimeMs)}
        <span className="text-fg-subtle"> / {formatTimecode(max)}</span>
      </span>

      <Slider
        label="Seek"
        min={0}
        max={max}
        step={33}
        value={Math.min(currentTimeMs, max)}
        className="flex-1"
        onChange={(e) => seek(Number(e.target.value))}
      />

      <IconButton label={silent ? 'Unmute' : 'Mute'} onClick={toggleMute}>
        {silent ? <VolumeX aria-hidden className="h-4 w-4 text-warning" /> : <Volume2 aria-hidden className="h-4 w-4" />}
      </IconButton>

      <Slider
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={isMuted ? 0 : volume}
        className="hidden w-20 sm:block"
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          if (isMuted && v > 0) toggleMute();
          if (!isMuted && v === 0) toggleMute();
        }}
      />
    </div>
  );
}
