import { Layers, Minus, Plus, Split, Trash2 } from 'lucide-react';
import { MouseEvent, useEffect } from 'react';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import { formatTimecode } from '../../utils/timecode';
import type { Track } from '../../types';
import { Playhead } from './Playhead';
import { SnapGuide } from './SnapGuide';
import { TimelineRuler } from './TimelineRuler';
import { TimelineTrack } from './TimelineTrack';

const DEFAULT_TRACKS = [
  { type: 'video', label: 'V1', color: '#2563eb' },
  { type: 'video', label: 'V2', color: '#7c3aed' },
  { type: 'audio', label: 'A1', color: '#059669' },
  { type: 'audio', label: 'A2', color: '#ea580c' },
] as const;

export function Timeline() {
  const { project, tracks, clips, deleteClips, splitClip, loadProject } = useProjectStore();
  const { selectedClipIds, zoomLevel, setZoom, deselectAll } = useUIStore();
  const { currentTimeMs, isPlaying, play, pause, seek, setSpeed } = usePlaybackStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (event.code) {
        case 'Delete': case 'Backspace':
          if (selectedClipIds.length > 0) deleteClips(selectedClipIds);
          break;
        case 'KeyS':
          if (selectedClipIds[0]) splitClip(selectedClipIds[0], currentTimeMs);
          break;
        case 'Space':
          event.preventDefault();
          isPlaying ? pause() : play();
          break;
        case 'Digit0':
          if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(12); }
          break;
        case 'KeyJ': setSpeed(-1); play(); break;
        case 'KeyK': pause(); break;
        case 'KeyL': setSpeed(1); play(); break;
        case 'ArrowLeft':
          if (!event.shiftKey) seek(Math.max(0, currentTimeMs - (event.altKey ? 1000 : 33)));
          break;
        case 'ArrowRight':
          if (!event.shiftKey) seek(currentTimeMs + (event.altKey ? 1000 : 33));
          break;
        case 'Home': seek(0); break;
        case 'End': {
          const last = clips.reduce((m, c) => Math.max(m, c.track_position_ms + c.duration_ms), 0);
          seek(last);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clips, currentTimeMs, deleteClips, isPlaying, pause, play, seek, selectedClipIds, setSpeed, setZoom, splitClip]);

  const createDefaultTracks = async () => {
    if (!project) return;
    for (let i = 0; i < DEFAULT_TRACKS.length; i++) {
      const t = DEFAULT_TRACKS[i];
      await api(`/projects/${project.id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ type: t.type, label: t.label, order_index: i + 1, color: t.color }),
      }).catch(console.error);
    }
    await loadProject(project.id);
  };

  const deselectFromBackground = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) deselectAll();
  };

  const totalDurationMs = clips.reduce(
    (max, c) => Math.max(max, c.track_position_ms + c.duration_ms),
    60000,
  );

  return (
    <section className="flex h-full flex-col bg-[#14171d]">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <div className="text-sm tabular-nums text-slate-300">{formatTimecode(currentTimeMs)}</div>
        <div className="flex items-center gap-2">
          {tracks.length === 0 && project && (
            <button
              title="Add default tracks (V1, V2, A1, A2)"
              className="flex items-center gap-1.5 rounded border border-dashed border-accent/60 px-2 py-1 text-xs text-accent hover:bg-accent/10"
              onClick={createDefaultTracks}
            >
              <Layers className="h-3.5 w-3.5" /> Add tracks
            </button>
          )}
          <button title="Zoom out" className="rounded border border-border p-1.5 hover:bg-white/5" onClick={() => setZoom(zoomLevel - 2)}><Minus className="h-4 w-4" /></button>
          <button title="Zoom in" className="rounded border border-border p-1.5 hover:bg-white/5" onClick={() => setZoom(zoomLevel + 2)}><Plus className="h-4 w-4" /></button>
          <button title="Split (S)" className="rounded border border-border p-1.5 hover:bg-white/5" onClick={() => selectedClipIds[0] && splitClip(selectedClipIds[0], currentTimeMs)}><Split className="h-4 w-4" /></button>
          <button title="Delete (Del)" className="rounded border border-border p-1.5 hover:bg-white/5" onClick={() => deleteClips(selectedClipIds)}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
          <Layers className="h-8 w-8 opacity-30" />
          <p className="text-sm">No tracks yet</p>
          {project && (
            <button
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-black hover:opacity-90"
              onClick={createDefaultTracks}
            >
              Create V1, V2, A1, A2
            </button>
          )}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-auto" onClick={deselectFromBackground}>
          <TimelineRuler durationMs={totalDurationMs} />
          <div className="relative" onClick={deselectFromBackground}>
            <Playhead />
            <SnapGuide />
            {tracks.map((track) => (
              <TimelineTrack
                key={track.id}
                track={track}
                clips={clips.filter((c) => c.track_id === track.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
