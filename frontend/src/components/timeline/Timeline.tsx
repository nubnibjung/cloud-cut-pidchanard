import { Layers, Minus, Plus, Split, Trash2 } from 'lucide-react';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import type { Track } from '../../types';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { toast } from '../../state/toastStore';
import { useUIStore } from '../../state/uiStore';
import { commandManager } from '../../state/commandManager';
import { formatTimecode, msToPixels } from '../../utils/timecode';
import { Button, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Feedback';
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

/** Subscribes to the playhead on its own so the rest of the timeline doesn't re-render every frame. */
function CurrentTimecode() {
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  return <div className="text-sm tabular-nums text-fg" aria-label="Playhead position">{formatTimecode(currentTimeMs)}</div>;
}

export function Timeline() {
  const project = useProjectStore((s) => s.project);
  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const deleteClips = useProjectStore((s) => s.deleteClips);
  const splitClip = useProjectStore((s) => s.splitClip);
  const loadProject = useProjectStore((s) => s.loadProject);
  const selectedClipIds = useUIStore((s) => s.selectedClipIds);
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const setZoom = useUIStore((s) => s.setZoom);
  const deselectAll = useUIStore((s) => s.deselectAll);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevZoomRef = useRef(zoomLevel);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prevZoomRef.current === zoomLevel) return;
    el.scrollLeft = el.scrollLeft * (zoomLevel / prevZoomRef.current);
    prevZoomRef.current = zoomLevel;
  }, [zoomLevel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Playback state is read at key time, so this listener isn't re-bound on every frame
      const { currentTimeMs, isPlaying, play, pause, seek, setSpeed } = usePlaybackStore.getState();
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
        case 'KeyZ':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (event.shiftKey) commandManager.redo();
            else commandManager.undo();
          }
          break;
        case 'KeyY':
          if (event.ctrlKey || event.metaKey) { event.preventDefault(); commandManager.redo(); }
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
  }, [clips, deleteClips, selectedClipIds, setZoom, splitClip]);

  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventDefault, true);
    window.addEventListener('drop', preventDefault, true);
    return () => {
      window.removeEventListener('dragover', preventDefault, true);
      window.removeEventListener('drop', preventDefault, true);
    };
  }, []);

  const [creatingTracks, setCreatingTracks] = useState(false);

  const createDefaultTracks = async () => {
    if (!project || creatingTracks) return;
    setCreatingTracks(true);
    try {
      // All four at once, and the responses are the new tracks — no project reload needed
      const results = await Promise.allSettled(
        DEFAULT_TRACKS.map((t, i) =>
          api<Track>(`/projects/${project.id}/tracks`, {
            method: 'POST',
            body: JSON.stringify({ type: t.type, label: t.label, order_index: i + 1, color: t.color }),
          }),
        ),
      );
      const created = results.flatMap((r) => (r.status === 'fulfilled' && r.value?.id ? [r.value] : []));
      const failed = results.find((r) => r.status === 'rejected');

      if (created.length > 0) {
        useProjectStore.setState((state) =>
          state.project?.id === project.id
            ? { tracks: [...state.tracks, ...created.filter((t) => !state.tracks.some((x) => x.id === t.id))] }
            : state,
        );
      }
      if (failed?.status === 'rejected') {
        toast.fromError('Some tracks could not be created')(failed.reason);
        // Pick up whatever the server did create
        if (created.length < DEFAULT_TRACKS.length) await loadProject(project.id);
      }
    } finally {
      setCreatingTracks(false);
    }
  };

  const deselectFromBackground = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) deselectAll();
  };

  const totalDurationMs = clips.reduce(
    (max, c) => Math.max(max, c.track_position_ms + c.duration_ms),
    60000,
  );
  const orderedTracks = [...tracks].sort((a, b) => {
    const typeRank = (t: typeof a) => t.type === 'video' ? 0 : 1;
    if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });

  const majorStep =
    zoomLevel >= 40 ? 1000 :
    zoomLevel >= 20 ? 2000 :
    zoomLevel >= 10 ? 5000 :
    zoomLevel >= 4  ? 10000 : 30000;
  const totalWidth = msToPixels(totalDurationMs + majorStep, zoomLevel);
  const hasSelection = selectedClipIds.length > 0;

  return (
    <section className="flex h-full flex-col overflow-clip bg-canvas" aria-label="Timeline">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-panel px-3">
        <CurrentTimecode />
        <div className="flex items-center gap-1">
          <IconButton
            label="Split at playhead"
            title={hasSelection ? 'Split at playhead (S)' : 'Select a clip to split it'}
            disabled={!hasSelection}
            onClick={() => { if (selectedClipIds[0]) splitClip(selectedClipIds[0], usePlaybackStore.getState().currentTimeMs); }}
          >
            <Split aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={hasSelection ? `Delete ${selectedClipIds.length} selected clip${selectedClipIds.length > 1 ? 's' : ''}` : 'Delete selected clips'}
            title={hasSelection ? 'Delete selected (Del)' : 'Select a clip to delete it'}
            disabled={!hasSelection}
            className="enabled:hover:bg-danger/15 enabled:hover:text-danger"
            onClick={() => { if (hasSelection) deleteClips(selectedClipIds); }}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-border" aria-hidden />
          <IconButton label="Zoom out" onClick={() => setZoom(Math.max(2, zoomLevel - 2))}>
            <Minus aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => setZoom(Math.min(80, zoomLevel + 2))}>
            <Plus aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {tracks.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Layers className="h-8 w-8" />}
          title="No tracks yet"
          description="Start with two video and two audio tracks. You can reorder them later."
          action={project && (
            <Button variant="primary" loading={creatingTracks} onClick={createDefaultTracks}>
              {!creatingTracks && <Plus aria-hidden className="h-4 w-4" />}
              {creatingTracks ? 'Adding tracks…' : 'Add default tracks'}
            </Button>
          )}
        />
      ) : (
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onClick={deselectFromBackground}>
          <TimelineRuler durationMs={totalDurationMs} />
          <div
            className="relative"
            style={{ minWidth: 120 + totalWidth }}
            onClick={deselectFromBackground}
          >
            <Playhead />
            <SnapGuide />
            {orderedTracks.map((track) => (
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
