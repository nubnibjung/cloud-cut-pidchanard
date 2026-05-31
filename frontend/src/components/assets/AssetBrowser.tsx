import { Film, Music, Image, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import type { Asset, AssetType } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import { AssetUpload } from './AssetUpload';

const TYPE_ICON: Record<string, React.ReactNode> = {
  video: <Film className="h-4 w-4 shrink-0 text-blue-400" />,
  audio: <Music className="h-4 w-4 shrink-0 text-green-400" />,
  image: <Image className="h-4 w-4 shrink-0 text-purple-400" />,
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'bg-green-900/40 text-green-400',
  processing: 'bg-yellow-900/40 text-yellow-400',
  uploading: 'bg-blue-900/40 text-blue-400',
  failed: 'bg-red-900/40 text-red-400',
};

export function AssetBrowser() {
  const project = useProjectStore((state) => state.project);
  const addClip = useProjectStore((state) => state.addClip);
  const tracks = useProjectStore((state) => state.tracks);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<AssetType | 'all'>('all');
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!project || project.id === 'project-seed') return;
    setLoading(true);
    api<Asset[]>(`/assets?projectId=${project.id}`)
      .then(setAssets)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [project?.id]);

  const handleDragStart = (e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData('application/cloudcut-asset', JSON.stringify(asset));
  };

  const handleDropOnTrack = (asset: Asset) => {
    const videoTrack = tracks.find((t) => t.type === 'video');
    if (!videoTrack) return;
    const durationMs = asset.metadata?.duration_ms ?? 5000;
    addClip({
      track_id: videoTrack.id,
      asset_id: asset.id,
      name: asset.original_url.split('/').pop() ?? 'Clip',
      track_position_ms: 0,
      in_point_ms: 0,
      out_point_ms: durationMs,
    });
  };

  const visible = assets.filter((a) => filter === 'all' || a.type === filter);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-[#171b23]">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-semibold">Assets</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      <div className="flex gap-1 border-b border-border p-2">
        {(['all', 'video', 'audio', 'image'] as const).map((t) => (
          <button
            key={t}
            className={`rounded px-2 py-1 text-xs capitalize ${filter === t ? 'bg-accent text-black' : 'bg-[#1e2330] text-slate-300 hover:bg-[#252b3b]'}`}
            onClick={() => setFilter(t)}
          >{t}</button>
        ))}
      </div>

      <AssetUpload projectId={project?.id ?? null} typeFilter={filter} onUploaded={(a) => { setAssets((prev) => [a, ...prev]); }} />

      <div className="flex flex-col gap-2 overflow-auto p-2">
        {visible.length === 0 && !loading && (
          <p className="py-6 text-center text-xs text-slate-500">No assets yet.<br />Upload a file above.</p>
        )}
        {visible.map((asset) => (
          <div
            key={asset.id}
            className="cursor-grab rounded border border-border bg-[#1e2330] p-2 hover:border-accent/40 active:cursor-grabbing"
            draggable
            onDragStart={(e) => handleDragStart(e, asset)}
            onDoubleClick={() => handleDropOnTrack(asset)}
            title="Double-click to add to timeline"
          >
            <div className="mb-1.5 flex items-center gap-2">
              {TYPE_ICON[asset.type] ?? TYPE_ICON.video}
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {asset.original_url.split('/').pop()}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[asset.status] ?? 'bg-surface text-slate-400'}`}>
                {asset.status}
              </span>
              {asset.metadata?.duration_ms && (
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {formatTimecode(asset.metadata.duration_ms)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
