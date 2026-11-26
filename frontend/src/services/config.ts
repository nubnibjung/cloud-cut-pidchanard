export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

/** Turns a stored asset/export path into an absolute URL on the API host. */
export function resolveUrl(url: string): string {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

/** Display name for an asset: the last path segment of its URL. */
export function fileNameFromUrl(url: string, fallback = 'Clip'): string {
  const tail = url.split('/').pop();
  if (!tail) return fallback;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/** What to call an asset in the UI: the uploaded file's own name when the server kept it. */
export function assetName(asset: { original_url: string; metadata?: { original_name?: string } }): string {
  return asset.metadata?.original_name || fileNameFromUrl(asset.original_url);
}
