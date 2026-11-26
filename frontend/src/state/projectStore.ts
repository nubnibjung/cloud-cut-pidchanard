import { create } from 'zustand';
import { api } from '../services/api';
import type { Clip, ClipEffect, Project, TextOverlay, Track, Transition } from '../types';
import { commandManager } from './commandManager';
import { toast } from './toastStore';

/** Edits are applied optimistically; tell the user when the server didn't accept one. */
const saveFailed = toast.fromError("A change couldn't be saved. Check your connection.");

/* Continuous edits (sliders, drags, scrubbing) update the screen on every tick but
   are saved once the user pauses, and land in undo history as one step. */
const EDIT_SETTLE_MS = 350;

type Transform = Clip['transform'];
const pendingTransforms = new Map<string, { from: Transform; timer: number }>();
const pendingEffectSaves = new Map<string, { timer: number; save(): void }>();
/** Effects created locally resolve to their server id once the POST returns. */
const effectServerIds = new Map<string, Promise<string>>();

const sameTransform = (a: Transform, b: Transform) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation && a.opacity === b.opacity;

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

interface NewClip {
  track_id: string;
  asset_id: string;
  name: string;
  track_position_ms: number;
  in_point_ms: number;
  out_point_ms: number;
}

interface TimelineDocument {
  project: Project;
  tracks: Track[];
  clips: Clip[];
  effects: ClipEffect[];
}

interface ProjectState {
  project: Project | null;
  tracks: Track[];
  clips: Clip[];
  effects: Record<string, ClipEffect[]>;
  transitions: Transition[];
  textOverlays: TextOverlay[];
  loading: boolean;
  error: string | null;
  loadProject(id: string): Promise<void>;
  addClip(clip: NewClip): void;
  moveClip(clipId: string, positionMs: number, trackId?: string): void;
  trimClip(clipId: string, inPointMs: number, outPointMs: number): void;
  updateClip(clipId: string, fields: Partial<Pick<Clip, 'track_position_ms' | 'in_point_ms' | 'out_point_ms' | 'track_id' | 'name'>>): void;
  splitClip(clipId: string, atTimeMs: number): void;
  deleteClips(clipIds: string[]): void;
  addEffect(clipId: string, effect: Omit<ClipEffect, 'id' | 'clip_id'>): void;
  updateEffect(clipId: string, effectId: string, params: unknown): void;
  deleteEffect(clipId: string, effectId: string): void;
  /** Live transform edit: shown at once, saved (and added to undo) when edits pause. */
  updateClipTransform(clipId: string, transform: Clip['transform']): void;
  /** Saves a pending transform edit right away, e.g. when a drag ends. */
  commitClipTransform(clipId: string): void;
  updateTrack(trackId: string, patch: Partial<Pick<Track, 'is_locked' | 'is_muted' | 'label' | 'color' | 'order_index'>>): void;
  reorderTrack(trackId: string, targetTrackId: string): void;
  applyRemoteOperation(op: { type: string; payload: unknown }): void;
}

function buildEffectsMap(effects: ClipEffect[]): Record<string, ClipEffect[]> {
  const map: Record<string, ClipEffect[]> = {};
  for (const effect of effects) {
    if (!map[effect.clip_id]) map[effect.clip_id] = [];
    map[effect.clip_id].push(effect);
  }
  return map;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  tracks: [],
  clips: [],
  effects: {},
  transitions: [],
  textOverlays: [],
  loading: false,
  error: null,

  async loadProject(id: string) {
    set({ loading: true, error: null });
    try {
      const doc = await api<TimelineDocument>(`/projects/${id}`);
      set({
        project: doc.project,
        tracks: doc.tracks,
        clips: doc.clips,
        effects: buildEffectsMap(doc.effects),
        transitions: [],
        textOverlays: [],
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load project' });
    }
  },

  addClip(newClip) {
    const projectId = get().project?.id;
    if (!projectId) return;
    const optimisticId = crypto.randomUUID();
    let currentId: string = optimisticId;

    const doAdd = () => {
      set((state) => ({
        clips: [...state.clips, {
          id: optimisticId,
          project_id: projectId,
          duration_ms: newClip.out_point_ms - newClip.in_point_ms,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
          version: 1,
          ...newClip,
        }],
      }));
      api<Clip>(`/projects/${projectId}/clips`, {
        method: 'POST',
        body: JSON.stringify(newClip),
      }).then((clip) => {
        currentId = clip.id;
        set((state) => ({ clips: state.clips.map((c) => c.id === optimisticId ? clip : c) }));
      }).catch(saveFailed);
    };

    commandManager.execute({
      id: optimisticId,
      type: 'add-clip',
      description: `Add ${newClip.name.split('/').pop() ?? 'clip'}`,
      timestamp: Date.now(),
      execute: doAdd,
      undo: () => {
        set((state) => ({ clips: state.clips.filter((c) => c.id !== currentId && c.id !== optimisticId) }));
        api(`/projects/${projectId}/clips/${currentId}`, { method: 'DELETE' }).catch(saveFailed);
      },
    });
  },

  moveClip(clipId, positionMs, trackId) {
    get().updateClip(clipId, { track_position_ms: positionMs, track_id: trackId });
  },

  trimClip(clipId, inPointMs, outPointMs) {
    get().updateClip(clipId, { in_point_ms: inPointMs, out_point_ms: outPointMs });
  },

  updateClip(clipId, fields) {
    const original = get().clips.find((c) => c.id === clipId);
    if (!original) return;
    const projectId = get().project?.id;

    const applyFields = (f: typeof fields) => {
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === clipId
            ? { ...c, ...f, duration_ms: (f.out_point_ms ?? c.out_point_ms) - (f.in_point_ms ?? c.in_point_ms) }
            : c
        ),
      }));
      if (projectId) {
        api<Clip>(`/projects/${projectId}/clips/${clipId}`, {
          method: 'PATCH',
          body: JSON.stringify(f),
        })
          .then((updatedClip) => {
            set((state) => ({ clips: state.clips.map((c) => c.id === clipId ? updatedClip : c) }));
          })
          .catch(saveFailed);
      }
    };

    const prevFields: typeof fields = {
      track_position_ms: original.track_position_ms,
      in_point_ms: original.in_point_ms,
      out_point_ms: original.out_point_ms,
      track_id: original.track_id,
      name: original.name,
    };

    commandManager.execute({
      id: crypto.randomUUID(),
      type: 'update-clip',
      description: 'Move/trim clip',
      timestamp: Date.now(),
      execute: () => applyFields(fields),
      undo: () => applyFields(prevFields),
    });
  },

  splitClip(clipId, atTimeMs) {
    const original = get().clips.find((c) => c.id === clipId);
    if (!original) return;
    const leftDuration = atTimeMs - original.track_position_ms;
    const rightDuration = original.duration_ms - leftDuration;
    if (leftDuration <= 0 || rightDuration <= 0) return;

    const rightId = crypto.randomUUID();
    const leftClip = { ...original, out_point_ms: original.in_point_ms + leftDuration, duration_ms: leftDuration };
    const rightClip = { ...original, id: rightId, name: `${original.name} Split`, track_position_ms: atTimeMs, in_point_ms: original.in_point_ms + leftDuration, duration_ms: rightDuration };

    commandManager.execute({
      id: crypto.randomUUID(),
      type: 'split-clip',
      description: 'Split clip',
      timestamp: Date.now(),
      execute: () => {
        set((state) => ({
          clips: state.clips.flatMap((c) => c.id === clipId ? [leftClip, rightClip] : [c]),
        }));
        const projectId = get().project?.id;
        if (projectId) {
          api<Clip[]>(`/projects/${projectId}/clips/${clipId}/split`, {
            method: 'POST',
            body: JSON.stringify({ at_time_ms: atTimeMs }),
          }).then(([left, right]) => {
            if (!left || !right) return;
            set((state) => {
              const without = state.clips.filter((c) => c.id !== clipId && c.id !== left.id && c.id !== right.id);
              return { clips: [...without, left, right].sort((a, b) => a.track_position_ms - b.track_position_ms) };
            });
          }).catch(saveFailed);
        }
      },
      undo: () => {
        set((state) => ({
          clips: state.clips.filter((c) => c.id !== rightId).map((c) =>
            c.id === clipId ? original : c
          ),
        }));
        const projectId = get().project?.id;
        if (projectId) {
          api(`/projects/${projectId}/clips/${rightId}`, { method: 'DELETE' }).catch(saveFailed);
          api<Clip>(`/projects/${projectId}/clips/${clipId}`, {
            method: 'PATCH',
            body: JSON.stringify({ out_point_ms: original.out_point_ms, duration_ms: original.duration_ms }),
          }).catch(saveFailed);
        }
      },
    });
  },

  deleteClips(clipIds) {
    if (clipIds.length === 0) return;
    const snapshot = get().clips.filter((c) => clipIds.includes(c.id));
    const projectId = get().project?.id;

    const doDelete = () => {
      set((state) => ({ clips: state.clips.filter((c) => !clipIds.includes(c.id)) }));
      if (projectId) {
        for (const id of clipIds) {
          api(`/projects/${projectId}/clips/${id}`, { method: 'DELETE' }).catch(saveFailed);
        }
      }
    };

    commandManager.execute({
      id: crypto.randomUUID(),
      type: 'delete-clips',
      description: clipIds.length === 1 ? 'Delete clip' : `Delete ${clipIds.length} clips`,
      timestamp: Date.now(),
      execute: doDelete,
      undo: () => {
        for (const clip of snapshot) {
          get().addClip({
            track_id: clip.track_id,
            asset_id: clip.asset_id,
            name: clip.name,
            track_position_ms: clip.track_position_ms,
            in_point_ms: clip.in_point_ms,
            out_point_ms: clip.out_point_ms,
          });
        }
      },
    });

  },

  addEffect(clipId, effect) {
    const localId = crypto.randomUUID();
    const newEffect: ClipEffect = { ...effect, id: localId, clip_id: clipId };
    set((state) => ({
      effects: { ...state.effects, [clipId]: [...(state.effects[clipId] ?? []), newEffect] },
    }));
    const projectId = get().project?.id;
    if (!projectId) return;
    const created = api<ClipEffect>(`/projects/${projectId}/clips/${clipId}/effects`, {
      method: 'POST',
      body: JSON.stringify({ type: effect.type, params: effect.params, enabled: effect.enabled }),
    }).then((saved) => {
      // Swap in the server's id so later edits and deletes reach the right row
      set((state) => ({
        effects: {
          ...state.effects,
          [clipId]: (state.effects[clipId] ?? []).map((e) => (e.id === localId ? { ...e, id: saved.id } : e)),
        },
      }));
      return saved.id;
    });
    effectServerIds.set(localId, created);
    created.catch(saveFailed);
  },

  updateEffect(clipId, effectId, params) {
    set((state) => ({
      effects: {
        ...state.effects,
        [clipId]: (state.effects[clipId] ?? []).map((e) =>
          e.id === effectId ? { ...e, params: params as { value: number } } : e
        ),
      },
    }));
    const projectId = get().project?.id;
    if (!projectId) return;
    const save = async () => {
      pendingEffectSaves.delete(effectId);
      const serverId = await (effectServerIds.get(effectId) ?? effectId);
      await api(`/projects/${projectId}/clips/${clipId}/effects/${serverId}`, {
        method: 'PATCH',
        body: JSON.stringify({ params }),
      });
    };
    const pending = pendingEffectSaves.get(effectId);
    if (pending) window.clearTimeout(pending.timer);
    pendingEffectSaves.set(effectId, {
      save: () => { save().catch(saveFailed); },
      timer: window.setTimeout(() => { save().catch(saveFailed); }, EDIT_SETTLE_MS),
    });
  },

  deleteEffect(clipId, effectId) {
    const pending = pendingEffectSaves.get(effectId);
    if (pending) { window.clearTimeout(pending.timer); pendingEffectSaves.delete(effectId); }
    set((state) => ({
      effects: {
        ...state.effects,
        [clipId]: (state.effects[clipId] ?? []).filter((e) => e.id !== effectId),
      },
    }));
    const projectId = get().project?.id;
    if (projectId) {
      Promise.resolve(effectServerIds.get(effectId) ?? effectId)
        .then((serverId) => api(`/projects/${projectId}/clips/${clipId}/effects/${serverId}`, { method: 'DELETE' }))
        .catch(saveFailed);
    }
  },

  updateClipTransform(clipId, transform) {
    const clip = get().clips.find((c) => c.id === clipId);
    if (!clip) return;
    const pending = pendingTransforms.get(clipId);
    if (pending) window.clearTimeout(pending.timer);
    const from = pending?.from ?? clip.transform;

    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, transform } : c)),
    }));
    pendingTransforms.set(clipId, {
      from,
      timer: window.setTimeout(() => get().commitClipTransform(clipId), EDIT_SETTLE_MS),
    });
  },

  commitClipTransform(clipId) {
    const pending = pendingTransforms.get(clipId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingTransforms.delete(clipId);

    const clip = get().clips.find((c) => c.id === clipId);
    const projectId = get().project?.id;
    if (!clip || !projectId || sameTransform(clip.transform, pending.from)) return;

    const to = clip.transform;
    const from = pending.from;
    const apply = (transform: Transform) => {
      set((state) => ({
        clips: state.clips.map((c) => (c.id === clipId ? { ...c, transform } : c)),
      }));
      api(`/projects/${projectId}/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ transform }),
      }).catch(saveFailed);
    };
    apply(to);
    commandManager.record({
      id: crypto.randomUUID(),
      type: 'transform-clip',
      description: 'Transform clip',
      timestamp: Date.now(),
      execute: () => apply(to),
      undo: () => apply(from),
    });
  },

  updateTrack(trackId, patch) {
    set((state) => ({
      tracks: state.tracks.map((t) => t.id === trackId ? { ...t, ...patch } : t),
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/tracks/${trackId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).catch(saveFailed);
    }
  },

  reorderTrack(trackId, targetTrackId) {
    if (trackId === targetTrackId) return;

    const projectId = get().project?.id;
    const reorderedTracks = (() => {
      const tracks = [...get().tracks].sort((a, b) => a.order_index - b.order_index);
      const fromIndex = tracks.findIndex((track) => track.id === trackId);
      const toIndex = tracks.findIndex((track) => track.id === targetTrackId);

      if (fromIndex < 0 || toIndex < 0) return null;

      const [movedTrack] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, movedTrack);

      return tracks.map((track, index) => ({ ...track, order_index: index + 1 }));
    })();

    if (!reorderedTracks) return;

    set({ tracks: reorderedTracks });

    if (projectId) {
      for (const track of reorderedTracks) {
        api(`/projects/${projectId}/tracks/${track.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ order_index: track.order_index }),
        }).catch(saveFailed);
      }
    }
  },

  applyRemoteOperation(op) {
    const { type, payload } = op as { type: string; payload: Record<string, unknown> };
    if (type === 'clip-updated' && payload.clip) {
      const clip = payload.clip as Clip;
      set((state) => ({ clips: state.clips.map((c) => c.id === clip.id ? { ...c, ...clip } : c) }));
    } else if (type === 'clip-deleted') {
      const clipId = payload.clipId as string;
      set((state) => ({ clips: state.clips.filter((c) => c.id !== clipId) }));
    } else if (type === 'clip-added' && payload.clip) {
      const clip = payload.clip as Clip;
      set((state) => ({
        clips: state.clips.some((c) => c.id === clip.id) ? state.clips : [...state.clips, clip],
      }));
    }
  },
}));

/** Saves every edit that is still waiting for its settle timer. */
export function flushPendingEdits(): void {
  for (const clipId of Array.from(pendingTransforms.keys())) useProjectStore.getState().commitClipTransform(clipId);
  for (const [effectId, pending] of Array.from(pendingEffectSaves.entries())) {
    window.clearTimeout(pending.timer);
    pendingEffectSaves.delete(effectId);
    pending.save();
  }
}

// Undo/redo must see the latest edit as its own step, not race its timer
commandManager.addFlusher(flushPendingEdits);
// Best effort: don't lose the last tweak when the tab closes
window.addEventListener('pagehide', flushPendingEdits);

// Dev only: hot-swapping this module would create a second, empty store while
// components still hold the old one. Reload the page instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
