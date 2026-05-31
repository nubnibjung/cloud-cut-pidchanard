import { create } from 'zustand';
import { api } from '../services/api';
import type { Clip, ClipEffect, Project, TextOverlay, Track, Transition } from '../types';

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
  splitClip(clipId: string, atTimeMs: number): void;
  deleteClips(clipIds: string[]): void;
  addEffect(clipId: string, effect: Omit<ClipEffect, 'id' | 'clip_id'>): void;
  updateEffect(clipId: string, effectId: string, params: unknown): void;
  updateClipTransform(clipId: string, transform: Clip['transform']): void;
  updateTrack(trackId: string, patch: Partial<Pick<Track, 'is_locked' | 'is_muted' | 'label' | 'color'>>): void;
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
      set((state) => ({ clips: state.clips.map((c) => c.id === optimisticId ? clip : c) }));
    }).catch(console.error);
  },

  moveClip(clipId, positionMs, trackId) {
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === clipId ? { ...c, track_position_ms: positionMs, track_id: trackId ?? c.track_id } : c
      ),
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ track_position_ms: positionMs, track_id: trackId }),
      }).catch(console.error);
    }
  },

  trimClip(clipId, inPointMs, outPointMs) {
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === clipId ? { ...c, in_point_ms: inPointMs, out_point_ms: outPointMs, duration_ms: outPointMs - inPointMs } : c
      ),
    }));
    const projectId = get().project?.id;
    if (projectId) {
      api(`/projects/${projectId}/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ in_point_ms: inPointMs, out_point_ms: outPointMs }),
      }).catch(console.error);
    }
  },

  splitClip(clipId, atTimeMs) {
    const projectId = get().project?.id;
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const leftDuration = atTimeMs - clip.track_position_ms;
      const rightDuration = clip.duration_ms - leftDuration;
      if (leftDuration <= 0 || rightDuration <= 0) return state;
      return {
        clips: state.clips.flatMap((c) =>
          c.id === clipId
            ? [
                { ...c, out_point_ms: c.in_point_ms + leftDuration, duration_ms: leftDuration },
                { ...c, id: crypto.randomUUID(), name: `${c.name} Split`, track_position_ms: atTimeMs, in_point_ms: c.in_point_ms + leftDuration, duration_ms: rightDuration },
              ]
            : [c]
        ),
      };
    });
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

  deleteClips(clipIds) {
    if (clipIds.length === 0) return;
    set((state) => ({ clips: state.clips.filter((c) => !clipIds.includes(c.id)) }));
    const projectId = get().project?.id;
    if (projectId) {
      for (const id of clipIds) {
        api(`/projects/${projectId}/clips/${id}`, { method: 'DELETE' }).catch(console.error);
      }
    }
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
