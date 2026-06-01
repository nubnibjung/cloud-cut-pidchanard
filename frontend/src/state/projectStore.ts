import { create } from 'zustand';
import { api } from '../services/api';
import type { Clip, ClipEffect, Project, TextOverlay, Track, Transition } from '../types';
import { commandManager } from './commandManager';

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
  updateClipTransform(clipId: string, transform: Clip['transform']): void;
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
      }).catch(console.error);
    };

    commandManager.execute({
      id: optimisticId,
      type: 'add-clip',
      description: `Add ${newClip.name.split('/').pop() ?? 'clip'}`,
      timestamp: Date.now(),
      execute: doAdd,
      undo: () => {
        set((state) => ({ clips: state.clips.filter((c) => c.id !== currentId && c.id !== optimisticId) }));
        api(`/projects/${projectId}/clips/${currentId}`, { method: 'DELETE' }).catch(console.error);
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
          .catch((err) => console.error('[projectStore] updateClip failed:', err));
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
          }).catch(console.error);
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
          api(`/projects/${projectId}/clips/${rightId}`, { method: 'DELETE' }).catch(console.error);
          api<Clip>(`/projects/${projectId}/clips/${clipId}`, {
            method: 'PATCH',
            body: JSON.stringify({ out_point_ms: original.out_point_ms, duration_ms: original.duration_ms }),
          }).catch(console.error);
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
          api(`/projects/${projectId}/clips/${id}`, { method: 'DELETE' }).catch(console.error);
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
    const newEffect: ClipEffect = { ...effect, id: crypto.randomUUID(), clip_id: clipId };
    set((state) => ({
      effects: { ...state.effects, [clipId]: [...(state.effects[clipId] ?? []), newEffect] },
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}/effects`, {
        method: 'POST',
        body: JSON.stringify({ type: (effect as { effect_type?: string }).effect_type ?? effect.type, params: effect.params, enabled: effect.enabled }),
      }).catch(console.error);
    }
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
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}/effects/${effectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ params }),
      }).catch(console.error);
    }
  },

  deleteEffect(clipId, effectId) {
    set((state) => ({
      effects: {
        ...state.effects,
        [clipId]: (state.effects[clipId] ?? []).filter((e) => e.id !== effectId),
      },
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}/effects/${effectId}`, { method: 'DELETE' }).catch(console.error);
    }
  },

  updateClipTransform(clipId, transform) {
    set((state) => ({
      clips: state.clips.map((c) => c.id === clipId ? { ...c, transform } : c),
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ transform }),
      }).catch(console.error);
    }
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
      }).catch(console.error);
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
        }).catch(console.error);
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
