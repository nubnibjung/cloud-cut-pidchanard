import { Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../services/api';
import type { Asset } from '../../types';

const ACCEPT: Record<string, string> = {
  video: 'video/*',
  audio: 'audio/*',
  image: 'image/*',
  all: 'video/*,audio/*,image/*',
};

interface Props {
  projectId: string | null;
  typeFilter?: string;
  onUploaded(asset: Asset): void;
}

function guessType(file: File): 'video' | 'audio' | 'image' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'image';
}

export function AssetUpload({ projectId, typeFilter = 'all', onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!projectId || projectId === 'project-seed') {
      setError('Open a real project first');
      return;
    }
    setError(null);
    setProgress('Uploading…');

    try {
      // 1. Upload file to backend
      const form = new FormData();
      form.append('file', file);
      const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';
      const uploadRes = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('cc_token') ?? ''}` },
        body: form,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());
      const { url } = await uploadRes.json() as { url: string };

      setProgress('Creating asset…');

      // 2. Confirm upload — creates Asset row + enqueues processing jobs
      const assetKey = crypto.randomUUID();
      const created = await api<{ asset_id: string; status: string }>('/assets/confirm-upload', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          asset_type: guessType(file),
          original_url: url,
          idempotency_key: assetKey,
        }),
      });

      const newAsset: Asset = {
        id: created.asset_id,
        project_id: projectId,
        type: guessType(file),
        original_url: url,
        status: 'processing',
        metadata: {},
      };

      onUploaded(newAsset);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = '';
  };

  return (
    <div className="border-b border-border p-2">
      <input ref={inputRef} type="file" accept={ACCEPT[typeFilter] ?? ACCEPT.all} className="hidden" onChange={onFileChange} />
      <button
        className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-border py-2 text-xs text-slate-400 hover:border-accent hover:text-accent"
        onClick={() => inputRef.current?.click()}
        disabled={!!progress}
      >
        <Upload className="h-3.5 w-3.5" />
        {progress ?? 'Upload file'}
      </button>
      {error && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-red-400">
          <X className="h-3 w-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
    </div>
  );
}
