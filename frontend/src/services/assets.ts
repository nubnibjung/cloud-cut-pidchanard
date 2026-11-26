import { useAuthStore } from '../state/authStore';
import type { Asset } from '../types';
import { api } from './api';

/* One shared asset cache for the editor. The asset list for a project already
   contains every asset its clips use, so the player and thumbnail code read
   from here instead of each fetching /assets/:id on their own. */

const byId = new Map<string, Asset>();
const listRequests = new Map<string, Promise<Asset[]>>();
const singleRequests = new Map<string, Promise<Asset>>();

function isRealProject(projectId: string | null | undefined): projectId is string {
  return !!projectId && projectId !== 'project-seed';
}

/** Loads (once, unless `force`) every asset of a project and caches each by id. */
export function loadProjectAssets(projectId: string, force = false): Promise<Asset[]> {
  const pending = listRequests.get(projectId);
  if (pending && !force) return pending;

  const request = api<Asset[]>(`/assets?projectId=${encodeURIComponent(projectId)}`).then((assets) => {
    for (const asset of assets) byId.set(asset.id, asset);
    return assets;
  });
  listRequests.set(projectId, request);
  request.catch(() => {
    if (listRequests.get(projectId) === request) listRequests.delete(projectId);
  });
  return request;
}

/** Resolves one asset, preferring the cache and the project's list request over a new call. */
export async function getAsset(assetId: string, projectId?: string | null): Promise<Asset> {
  const cached = byId.get(assetId);
  if (cached) return cached;

  if (isRealProject(projectId)) {
    await loadProjectAssets(projectId).catch(() => undefined);
    const fromList = byId.get(assetId);
    if (fromList) return fromList;
  }

  const pending = singleRequests.get(assetId);
  if (pending) return pending;
  const request = api<Asset>(`/assets/${assetId}`)
    .then((asset) => {
      byId.set(asset.id, asset);
      return asset;
    })
    .finally(() => singleRequests.delete(assetId));
  singleRequests.set(assetId, request);
  return request;
}

export function peekAsset(assetId: string): Asset | undefined {
  return byId.get(assetId);
}

export function rememberAsset(asset: Asset): void {
  byId.set(asset.id, asset);
}

export function forgetAsset(assetId: string): void {
  byId.delete(assetId);
}

useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    byId.clear();
    listRequests.clear();
    singleRequests.clear();
  }
});
