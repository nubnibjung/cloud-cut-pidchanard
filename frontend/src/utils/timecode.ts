export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor((ms % 1000) / (1000 / 30));
  return [hours, minutes, seconds, frames].map((value) => value.toString().padStart(2, '0')).join(':');
}

export function msToPixels(ms: number, zoomLevel: number): number {
  return (ms * zoomLevel) / 1000;
}

export function pixelsToMs(px: number, zoomLevel: number): number {
  return Math.round((px / zoomLevel) * 1000);
}
