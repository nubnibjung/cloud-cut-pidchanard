import { create } from 'zustand';
import type { Tool } from '../types';

interface UIState {
  selectedClipIds: string[];
  zoomLevel: number;
  scrollPosition: number;
  activeTool: Tool;
  snapEnabled: boolean;
  panelSizes: { left: number; center: number; right: number; bottom: number };
  selectClip(id: string, additive?: boolean): void;
  deselectAll(): void;
  setZoom(level: number): void;
  setScrollPosition(position: number): void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedClipIds: [],
  zoomLevel: 12,
  scrollPosition: 0,
  activeTool: 'select',
  snapEnabled: true,
  panelSizes: { left: 20, center: 55, right: 25, bottom: 40 },
  selectClip(id, additive = false) {
    set((state) => ({ selectedClipIds: additive ? Array.from(new Set([...state.selectedClipIds, id])) : [id] }));
  },
  deselectAll() {
    set({ selectedClipIds: [] });
  },
  setZoom(level) {
    set({ zoomLevel: Math.min(60, Math.max(3, level)) });
  },
  setScrollPosition(position) {
    set({ scrollPosition: Math.max(0, position) });
  }
}));
