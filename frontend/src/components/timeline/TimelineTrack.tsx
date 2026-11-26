import { Eye, EyeOff, GripVertical, Lock, Unlock, Volume2, VolumeX } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../services/api';
import { API_BASE, assetName } from '../../services/config';
import { useAuthStore } from '../../state/authStore';
import { useProjectStore } from '../../state/projectStore';
import { toast } from '../../state/toastStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset, Clip, Track } from '../../types';
import { cn } from '../../utils/cn';
import { TimelineClip } from './TimelineClip';

interface Props {
  track: Track;
  clips: Clip[];
}

export function TimelineTrack({ track, clips }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [trackDragOver, setTrackDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);
  const addClip = useProjectStore((s) => s.addClip);
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const reorderTrack = useProjectStore((s) => s.reorderTrack);
  const toggleTrackHidden = useUIStore((s) => s.toggleTrackHidden);
  const hidden = useUIStore((s) => s.hiddenTrackIds.has(track.id));
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const pendingAsset = useUIStore((s) => s.pendingAsset);
  const setPendingAsset = useUIStore((s) => s.setPendingAsset);

  /* ── drag-and-drop from Asset Browser or Local File ──────────────────── */
  const guessType = (file: File): 'video' | 'audio' | 'image' => {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'image';
  };

  const hasType = (types: readonly string[] | DataTransfer['types'] | null, target: string) => {
    if (!types) return false;
    return Array.from(types).includes(target);
  };

  const isTrackDrag = (e: React.DragEvent) =>
    hasType(e.dataTransfer.types, 'application/cloudcut-track');

  const canDropAsset = (assetType: Asset['type']) =>
    track.type === (assetType === 'audio' ? 'audio' : 'video');

  const positionFromClientX = (clientX: number) => {
    const rect = dropRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.round(((clientX - rect.left) / zoomLevel) * 1000)) : 0;
  };

  const addAssetToTrack = (asset: Asset, positionMs: number) => {
    if (!canDropAsset(asset.type)) return false;
    const durationMs = asset.metadata?.duration_ms ?? 5000;
    addClip({
      track_id: track.id,
      asset_id: asset.id,
      name: assetName(asset),
      track_position_ms: positionMs,
      in_point_ms: 0,
      out_point_ms: durationMs,
    });
    return true;
  };

  const onTrackDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/cloudcut-track', track.id);
  };

  const onTrackDragOver = (e: React.DragEvent) => {
    if (!isTrackDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setTrackDragOver(true);
  };

  const onTrackDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setTrackDragOver(false);
  };

  const onTrackDrop = (e: React.DragEvent) => {
    if (!isTrackDrag(e)) return;
    e.preventDefault();
    setTrackDragOver(false);

    const draggedTrackId = e.dataTransfer.getData('application/cloudcut-track');
    if (draggedTrackId) reorderTrack(draggedTrackId, track.id);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (hasType(e.dataTransfer.types, 'application/cloudcut-track')) return;
    e.preventDefault();
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (hasType(e.dataTransfer.types, 'application/cloudcut-track')) return;
    e.preventDefault();            // required to allow drop
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    // only clear when truly leaving this element, not when entering a child
    if (dropRef.current && dropRef.current.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const positionMs = positionFromClientX(e.clientX);

    // A. File dropped from local computer
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const projectId = project?.id;
      if (!projectId) return;
      if (!canDropAsset(guessType(file))) return;

      try {
        const form = new FormData();
        form.append('file', file);
        const uploadRes = await fetch(`${API_BASE}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${useAuthStore.getState().token ?? ''}` },
          body: form,
        });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const { url } = await uploadRes.json() as { url: string };

        const assetKey = crypto.randomUUID();
        const created = await api<{ asset_id: string; status: string }>('/assets/confirm-upload', {
          method: 'POST',
          body: JSON.stringify({
            project_id: projectId,
            asset_type: guessType(file),
            original_url: url,
            idempotency_key: assetKey,
            original_name: file.name,
          }),
        });

        const durationMs = 5000;
        addClip({
          track_id: track.id,
          asset_id: created.asset_id,
          name: file.name,
          track_position_ms: positionMs,
          in_point_ms: 0,
          out_point_ms: durationMs,
        });
      } catch (err) {
        toast.fromError('Could not upload the dropped file')(err);
      }
      return;
    }

    // B. Asset dragged from Asset Browser
    const raw = e.dataTransfer.getData('application/cloudcut-asset');
    if (!raw) return;

    try {
      const asset: Asset = JSON.parse(raw);
      if (!asset || !asset.id) return;
      addAssetToTrack(asset, positionMs);
    } catch (err) {
      console.warn('Failed to parse dropped asset data:', err);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (!pendingAsset) return;
    if (addAssetToTrack(pendingAsset, positionFromClientX(e.clientX))) {
      setPendingAsset(null);
    }
  };

  // 22px targets: the most that fits beside the label in the 120px header
  const iconBtn = 'flex h-[22px] w-[22px] items-center justify-center rounded transition-colors hover:bg-ink/10 hover:text-fg';

  return (
    <div
      className={cn(
        'grid h-16 grid-cols-[120px_1fr] border-b border-border',
        trackDragOver && 'bg-accent/10 outline outline-1 outline-accent/50',
      )}
      onDragOver={onTrackDragOver}
      onDragLeave={onTrackDragLeave}
      onDrop={onTrackDrop}
    >
      {/* ── Track header ──────────────────────────────────────────────── */}
      <div
        className="sticky left-0 z-[5] flex items-center justify-between border-r border-border bg-panel pl-1 pr-0.5"
        data-allow-native-drag="true"
        draggable={true}
        onDragStart={onTrackDragStart}
        onDragEnd={() => setTrackDragOver(false)}
        title="Drag to reorder track"
      >
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <GripVertical aria-hidden className="h-3.5 w-3 shrink-0 cursor-grab text-fg-subtle active:cursor-grabbing" />
          <div aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: track.color }} />
          <span className="whitespace-nowrap text-xs font-medium">{track.label}</span>
        </div>
        <div className="flex shrink-0 items-center text-fg-muted">
          <button
            type="button"
            className={cn(iconBtn, track.is_locked && 'text-warning')}
            aria-label={`${track.is_locked ? 'Unlock' : 'Lock'} track ${track.label}`}
            aria-pressed={track.is_locked}
            title={track.is_locked ? 'Unlock' : 'Lock'}
            draggable={false}
            onClick={() => updateTrack(track.id, { is_locked: !track.is_locked })}
          >
            {track.is_locked ? <Lock aria-hidden className="h-3.5 w-3.5" /> : <Unlock aria-hidden className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className={cn(iconBtn, track.is_muted && 'text-warning')}
            aria-label={`${track.is_muted ? 'Unmute' : 'Mute'} track ${track.label}`}
            aria-pressed={track.is_muted}
            title={track.is_muted ? 'Unmute' : 'Mute'}
            draggable={false}
            onClick={() => updateTrack(track.id, { is_muted: !track.is_muted })}
          >
            {track.is_muted ? <VolumeX aria-hidden className="h-3.5 w-3.5" /> : <Volume2 aria-hidden className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className={cn(iconBtn, hidden && 'text-warning')}
            aria-label={`${hidden ? 'Show' : 'Hide'} track ${track.label}`}
            aria-pressed={hidden}
            title={hidden ? 'Show' : 'Hide'}
            draggable={false}
            onClick={() => toggleTrackHidden(track.id)}
          >
            {hidden ? <EyeOff aria-hidden className="h-3.5 w-3.5" /> : <Eye aria-hidden className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Track body (drop zone) ─────────────────────────────────────── */}
      <div
        ref={dropRef}
        data-track-id={track.id}
        className={cn(
          'relative min-w-0 bg-ink/[0.015]',
          dragOver && 'bg-accent/15 outline outline-1 outline-accent/50',
          pendingAsset && !track.is_locked && 'cursor-copy',
          track.is_locked && 'pointer-events-none opacity-50',
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
      >
        {!hidden && clips.map((clip) => (
          <TimelineClip key={clip.id} clip={clip} trackColor={track.color} trackMuted={track.is_muted} />
        ))}

        {hidden && (
          <span className="pointer-events-none absolute inset-0 flex select-none items-center pl-3 text-2xs text-fg-subtle">
            Hidden
          </span>
        )}

        {!hidden && clips.length === 0 && !dragOver && (
          <span className="pointer-events-none absolute inset-0 flex select-none items-center pl-3 text-2xs text-fg-subtle">
            Drop {track.type === 'audio' ? 'audio' : 'video or images'} here
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
