import { AlertCircle, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../services/api';
import { API_BASE } from '../../services/config';
import { useAuthStore } from '../../state/authStore';
import { Spinner } from '../ui/Feedback';
import { ShimmeringText } from '../ui/ShimmeringText';
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

function probeDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const type = guessType(file);
    if (type === 'image') { resolve(null); return; }
    const el = type === 'audio'
      ? document.createElement('audio')
      : document.createElement('video');
    el.preload = 'metadata';
    const url = URL.createObjectURL(file);
    el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null); };
    el.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    el.src = url;
  });
}

interface UploadTarget {
  upload_url: string;
  direct: boolean;
  public_url: string | null;
}

/** PUT to a presigned URL, reporting progress (fetch can't report upload progress). */
function putWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Upload failed (${xhr.status}). Please try again.`)));
    // A CORS rule missing on the bucket also lands here
    xhr.onerror = () => reject(new Error("Upload failed: couldn't reach the file storage."));
    xhr.send(file);
  });
}

async function uploadToServer(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${useAuthStore.getState().token ?? ''}` },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return ((await res.json()) as { url: string }).url;
}

export function AssetUpload({ projectId, typeFilter = 'all', onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!projectId || projectId === 'project-seed') {
      setError("The project hasn't finished loading. Wait a moment, or reload the page.");
      return;
    }
    setError(null);
    setProgress('Uploading…');

    try {
      // 1. Probe duration from browser (no server needed)
      const durationMs = await probeDurationMs(file);

      // 2. Upload the file: straight to object storage when the server has it set up
      //    (large videos never pass through the API server), otherwise to the server's disk
      const target = await api<UploadTarget>('/assets/presigned-url', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, filename: file.name, content_type: file.type || 'application/octet-stream' }),
      });
      const url = target.direct && target.public_url
        ? await putWithProgress(target.upload_url, file, (pct) => setProgress(`Uploading… ${pct}%`)).then(() => target.public_url!)
        : await uploadToServer(file);

      setProgress('Creating asset…');

      // 3. Confirm upload — send browser-detected duration so backend marks asset ready immediately
      const assetKey = crypto.randomUUID();
      const created = await api<{ asset_id: string; status: string }>('/assets/confirm-upload', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          asset_type: guessType(file),
          original_url: url,
          idempotency_key: assetKey,
          original_name: file.name,
          ...(durationMs ? { duration_ms: durationMs } : {}),
        }),
      });

      const newAsset: Asset = {
        id: created.asset_id,
        project_id: projectId,
        type: guessType(file),
        original_url: url,
        status: durationMs ? 'ready' : 'processing',
        metadata: { original_name: file.name, ...(durationMs ? { duration_ms: durationMs } : {}) },
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
    <div className="shrink-0 p-2">
      <input ref={inputRef} type="file" accept={ACCEPT[typeFilter] ?? ACCEPT.all} className="hidden" tabIndex={-1} aria-hidden onChange={onFileChange} />
      <button
        type="button"
        className="group/upload flex w-full items-center gap-2.5 rounded-lg border border-dashed border-border-strong p-1.5 text-left transition-colors hover:border-accent/70 hover:bg-accent/[0.06] disabled:cursor-progress"
        onClick={() => inputRef.current?.click()}
        disabled={!!progress || !projectId}
        aria-busy={!!progress}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-fg-muted transition-colors group-hover/upload:bg-accent/15 group-hover/upload:text-accent">
          {progress ? <Spinner className="h-4 w-4" /> : <Upload aria-hidden className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-fg">
            {progress ? <ShimmeringText text={progress} color="rgb(var(--c-fg-muted))" /> : 'Upload media'}
          </span>
          <span className="block truncate text-2xs text-fg-subtle">
            {typeFilter === 'all' ? 'Video, audio or images' : `${typeFilter.charAt(0).toUpperCase()}${typeFilter.slice(1)} files`}
          </span>
        </span>
      </button>
      {error && (
        <p className="mt-1.5 flex items-start gap-1 text-2xs text-danger" role="alert">
          <AlertCircle aria-hidden className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
