import { useUIStore } from '../state/uiStore';

export function useZoom() {
  return useUIStore((state) => ({ zoomLevel: state.zoomLevel, setZoom: state.setZoom }));
}
