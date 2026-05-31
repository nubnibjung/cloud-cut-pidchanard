import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX } from 'lucide-react';
import { useRef, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import type { Asset, Clip, Track } from '../../types';
import { TimelineClip } from './TimelineClip';

interface Props {
  track: Track;
  clips: Clip[];
}

export function TimelineTrack({ track, clips }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [hidden, setHidden] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const addClip = useProjectStore((s) => s.addClip);
  const updateTrack = useProjectStore((s) => s.updateTrack);

  /* ── drag-and-drop from Asset Browser ─────────────────────────────────── */
  const isAssetDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('application/cloudcut-asset');

  const onDragEnter = (e: React.DragEvent) => {
    if (!isAssetDrag(e)) return;
    e.preventDefault();
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!isAssetDrag(e)) return;
    e.preventDefault();            // required to allow drop
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    // only clear when truly leaving this element, not when entering a child
    if (dropRef.current && dropRef.current.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('application/cloudcut-asset');
    if (!raw) return;

    const asset: Asset = JSON.parse(raw);
    const durationMs = asset.metadata?.duration_ms ?? 5000;

    // calculate drop position from mouse x relative to track content area
    const rect = dropRef.current?.getBoundingClientRect();
    const zoomLevel = 12;
    const positionMs = rect
      ? Math.max(0, Math.round(((e.clientX - rect.left) / zoomLevel) * 1000))
      : 0;

    addClip({
      track_id: track.id,
      asset_id: asset.id,
      name: asset.original_url.split('/').pop() ?? 'Clip',
      track_position_ms: positionMs,
      in_point_ms: 0,
      out_point_ms: durationMs,
    });
  };

  const iconBtn = 'rounded p-0.5 hover:bg-white/10 transition-colors cursor-pointer';

  return (
    <div className="grid h-16 grid-cols-[96px_1fr] border-b border-border">
      {/* ── Track header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-r border-border bg-[#171b23] px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: track.color }} />
          <span className="truncate text-xs font-medium">{track.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-slate-400">
          <button
            className={`${iconBtn} ${track.is_locked ? 'text-yellow-400' : ''}`}
            title={track.is_locked ? 'Unlock' : 'Lock'}
            onClick={() => updateTrack(track.id, { is_locked: !track.is_locked })}
          >
            {track.is_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </button>
          <button
            className={`${iconBtn} ${track.is_muted ? 'text-yellow-400' : ''}`}
            title={track.is_muted ? 'Unmute' : 'Mute'}
            onClick={() => updateTrack(track.id, { is_muted: !track.is_muted })}
          >
            {track.is_muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
          <button
            className={`${iconBtn} ${hidden ? 'text-slate-600' : ''}`}
            title={hidden ? 'Show' : 'Hide'}
            onClick={() => setHidden(!hidden)}
          >
            {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* ── Track body (drop zone) ─────────────────────────────────────── */}
      <div
        ref={dropRef}
        data-track-id={track.id}
        className={[
          'relative min-w-0',
          dragOver ? 'bg-accent/15 outline outline-1 outline-accent/50' : '',
          track.is_locked ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {!hidden && clips.map((clip) => (
          <TimelineClip key={clip.id} clip={clip} trackMuted={track.is_muted} />
        ))}

        {hidden && (
          <span className="pointer-events-none absolute inset-0 flex select-none items-center pl-3 text-[11px] italic text-slate-600">
            Hidden
          </span>
        )}

        {!hidden && clips.length === 0 && !dragOver && (
          <span className="pointer-events-none absolute inset-0 flex select-none items-center pl-3 text-[11px] text-slate-600">
            Drop asset here
          </span>
        )}

        {dragOver && (
          <span className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-xs font-medium text-accent">
            Drop to add clip
          </span>
        )}
      </div>
    </div>
  );
}
