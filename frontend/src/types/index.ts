export type AssetType = 'video' | 'audio' | 'image';
export type TrackType = 'video' | 'audio';
export type Tool = 'select' | 'blade' | 'hand';

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
}

export interface Asset {
  id: string;
  project_id: string;
  type: AssetType;
  original_url: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  metadata: { duration_ms?: number; thumbnail?: string };
}

export interface Track {
  id: string;
  project_id: string;
  type: TrackType;
  label: string;
  order_index: number;
  is_locked: boolean;
  is_muted: boolean;
  color: string;
}

export interface Clip {
  id: string;
  project_id: string;
  track_id: string;
  asset_id: string;
  name: string;
  track_position_ms: number;
  in_point_ms: number;
  out_point_ms: number;
  duration_ms: number;
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  version: number;
}

export interface ClipEffect {
  id: string;
  clip_id: string;
  type: 'brightness' | 'contrast' | 'saturation' | 'blur';
  order_index: number;
  params: { value: number };
  enabled: boolean;
}

export interface Transition {
  id: string;
}

export interface TextOverlay {
  id: string;
}
