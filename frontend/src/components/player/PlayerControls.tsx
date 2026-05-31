import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { usePlaybackStore } from '../../state/playbackStore';
import { formatTimecode } from '../../utils/timecode';

interface Props { totalMs?: number }

export function PlayerControls({ totalMs = 60000 }: Props) {
  const { isPlaying, play, pause, currentTimeMs, seek, isMuted, toggleMute, volume, setVolume } = usePlaybackStore();
  const max = Math.max(totalMs, 1000);

  return (
    <div className="flex h-12 items-center gap-2 border-t border-border bg-[#151820] px-3">
      <button
        className="rounded border border-border p-1.5 hover:bg-white/5"
        onClick={() => isPlaying ? pause() : play()}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <span className="w-[88px] shrink-0 text-xs tabular-nums text-slate-300">
        {formatTimecode(currentTimeMs)}
        <span className="text-slate-600"> / {formatTimecode(max)}</span>
      </span>

      {/* Seekbar */}
      <input
        type="range" min={0} max={max} step={33}
        value={Math.min(currentTimeMs, max)}
        className="min-w-0 flex-1 accent-accent"
        onChange={(e) => seek(Number(e.target.value))}
      />

      {/* Mute */}
      <button
        className="rounded border border-border p-1.5 hover:bg-white/5"
        onClick={toggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? <VolumeX className="h-4 w-4 text-yellow-400" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/* Volume */}
      <input
        type="range" min={0} max={1} step={0.01}
        value={isMuted ? 0 : volume}
        className="w-20 accent-accent"
        onChange={(e) => { setVolume(Number(e.target.value)); if (isMuted) toggleMute(); }}
      />
    </div>
  );
}
