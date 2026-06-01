import { ArrowLeft, Download, Scissors, Undo2, Redo2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import { commandManager } from '../shared/UndoHistory';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

function resolveUrl(url: string) {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

interface ExportJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress_percent: number;
  output_url: string | null;
  error_message: string | null;
}

interface Props { onBack?(): void }

export function TopBar({ onBack }: Props) {
  const project = useProjectStore((s) => s.project);
  const clips = useProjectStore((s) => s.clips);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const cancelRef = useRef(false);
  const exportIdRef = useRef<string | null>(null);
  const timelineSignature = clips
    .map((clip) => [
      clip.id,
      clip.track_id,
      clip.asset_id,
      clip.track_position_ms,
      clip.in_point_ms,
      clip.out_point_ms,
    ].join(':'))
    .join('|');

  useEffect(() => {
    setDownloadUrl('');
    setProgress('');
  }, [project?.id, timelineSignature]);

  const downloadExport = async (url: string) => {
    const response = await fetch(resolveUrl(url));
    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${project?.name ?? 'export'}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  };

  const cancelExport = async () => {
    cancelRef.current = true;
    const id = exportIdRef.current;
    if (id) {
      try { await api(`/exports/${id}`, { method: 'DELETE' }); } catch { /* ignore */ }
    }
    setExporting(false);
    setProgress('');
    setError('Export cancelled');
    exportIdRef.current = null;
  };

  const handleExport = async () => {
    if (!project) { setError('Open a project first'); return; }
    if (clips.length === 0) { setError('Add clips to the timeline first'); return; }

    cancelRef.current = false;
    setExporting(true);
    setError('');
    setDownloadUrl('');
    setProgress('Queuing render…');

    try {
      const job = await api<ExportJob>(`/projects/${project.id}/exports`, {
        method: 'POST',
        body: JSON.stringify({
          format: 'mp4',
          resolution: '1080p',
          quality: 'standard',
          idempotency_key: `export:${project.id}:${Date.now()}`,
          timeline_clips: clips.map((clip) => ({
            track_id: clip.track_id,
            asset_id: clip.asset_id,
            track_position_ms: clip.track_position_ms,
            in_point_ms: clip.in_point_ms,
            out_point_ms: clip.out_point_ms,
          })),
        }),
      });

      exportIdRef.current = job.id;

      // If job came back already failed (e.g. previous stuck job), show error immediately
      if (job.status === 'failed') {
        setError(job.error_message ?? 'Previous export failed — click Export to retry');
        setExporting(false);
        return;
      }

      // Track last known progress to detect stalls
      let lastPct = job.progress_percent;
      let staleCount = 0;
      const STALE_LIMIT = 15; // 30 seconds of no change → show that the render is still running

      // Poll until done, cancelled, or timed out (30 min)
      const deadline = Date.now() + 30 * 60 * 1000;

      for (;;) {
        if (cancelRef.current) break;
        if (Date.now() > deadline) {
          setError('Render timed out after 30 minutes');
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
        if (cancelRef.current) break;

        const current = await api<ExportJob>(`/exports/${job.id}`);

        if (current.status === 'completed' && current.output_url) {
          setProgress('Render complete — downloading…');
          setDownloadUrl(current.output_url);
          setProgress('Render complete. Download is ready.');
          await downloadExport(current.output_url);
          break;
        }

        if (current.status === 'failed') {
          setError(current.error_message ?? 'Render failed');
          break;
        }

        if (current.status === 'cancelled') {
          setError('Export cancelled');
          break;
        }

        // Still rendering — check for stall
        if (current.progress_percent === lastPct) {
          staleCount++;
          if (staleCount >= STALE_LIMIT) {
            setProgress(`Rendering… ${current.progress_percent}% (still working…)`);
          } else {
            setProgress(`Rendering… ${current.progress_percent}%`);
          }
        } else {
          staleCount = 0;
          lastPct = current.progress_percent;
          setProgress(`Rendering… ${current.progress_percent}%`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
      exportIdRef.current = null;
    }
  };

  return (
    <div className="flex h-12 items-center justify-between border-b border-border bg-[#151820] px-4">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="rounded border border-border p-1.5 hover:bg-white/5" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <Scissors className="h-5 w-5 text-accent" />
        <span className="max-w-[200px] truncate text-sm font-semibold">{project?.name ?? 'CloudCut'}</span>
      </div>

      <div className="flex items-center gap-2">
        {error && (
          <span
            className="cursor-pointer text-xs text-red-400 hover:text-red-300"
            title="Click to dismiss"
            onClick={() => setError('')}
          >
            {error}
          </span>
        )}
        {progress && !error && <span className="text-xs text-slate-400">{progress}</span>}
        {downloadUrl && !exporting && (
          <button
            className="flex items-center gap-1.5 rounded border border-emerald-700/60 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-900/20"
            onClick={() => downloadExport(downloadUrl).catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))}
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        )}

        <button title="Undo (Ctrl+Z)" className="rounded border border-border p-2 hover:bg-white/5" onClick={() => commandManager.undo()}>
          <Undo2 className="h-4 w-4" />
        </button>
        <button title="Redo (Ctrl+Shift+Z)" className="rounded border border-border p-2 hover:bg-white/5" onClick={() => commandManager.redo()}>
          <Redo2 className="h-4 w-4" />
        </button>

        {exporting ? (
          <button
            onClick={cancelExport}
            className="flex items-center gap-1.5 rounded border border-red-800/60 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-900/20"
            title="Cancel export"
          >
            <XCircle className="h-4 w-4" />
            Cancel
          </button>
        ) : (
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-black hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            {error ? 'Retry Export' : 'Export'}
          </button>
        )}
      </div>
    </div>
  );
}
