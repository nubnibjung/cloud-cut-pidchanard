import { create } from 'zustand';

interface PlaybackState {
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: number;
  volume: number;
  isMuted: boolean;
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  setSpeed(speed: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  isPlaying: false,
  playbackSpeed: 1,
  volume: 0.8,
  isMuted: false,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  seek: (timeMs) => set({ currentTimeMs: Math.max(0, timeMs) }),
  setSpeed: (speed) => set({ playbackSpeed: speed }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted }))
}));
