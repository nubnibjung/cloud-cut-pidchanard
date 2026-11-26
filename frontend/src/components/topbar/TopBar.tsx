import { ArrowLeft, Download, Redo2, Undo2, Upload, XCircle } from 'lucide-react';
import { APP_NAME, LogoMark } from '../ui/Logo';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { resolveUrl } from '../../services/config';
import { commandManager } from '../../state/commandManager';
import { useProjectStore } from '../../state/projectStore';
import { AnimatedThemeToggler } from '../ui/AnimatedThemeToggler';
import { Button, IconButton } from '../ui/Button';
import { LottieIllustration } from '../ui/LottieIllustration';

interface ExportJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress_percent: number;
  output_url: string | null;
  error_message: string | null;
}

interface Props { onBack?(): void }

/** How long to keep polling through a dropped connection (a Render restart takes ~1 min). */
const RECONNECT_FOR_MS = 120_000;
/** fetch() rejects with a TypeError when the request never got a response. */
const isNetworkError = (err: unknown) => err instanceof TypeError;

export function TopBar({ onBack }: Props) {
  const project = useProjectStore((s) => s.project);
  const clips = useProjectStore((s) => s.clips);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [percent, setPercent] = useState(0);
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
      clip.transform.x,
      clip.transform.y,
      clip.transform.scale,
      clip.transform.rotation,
      clip.transform.opacity,
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
    setPercent(0);
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
            track_position_ms: Math.round(clip.track_position_ms),
            in_point_ms: Math.round(clip.in_point_ms),
            out_point_ms: Math.round(clip.out_point_ms),
            transform: clip.transform,
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
      let offlineSince = 0;

      for (;;) {
        if (cancelRef.current) break;
        if (Date.now() > deadline) {
          setError('Render timed out after 30 minutes');
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
        if (cancelRef.current) break;

        let current: ExportJob;
        try {
          current = await api<ExportJob>(`/exports/${job.id}`);
          offlineSince = 0;
        } catch (err) {
          // A dropped connection or a server restart shouldn't end the export on the
          // first failed poll: keep asking for a while, and the server will report the
          // job as finished or as interrupted once it is reachable again.
          if (!isNetworkError(err)) throw err;
          offlineSince ||= Date.now();
          if (Date.now() - offlineSince > RECONNECT_FOR_MS) {
            throw new Error("Lost connection to the server during the export. Try again in a minute.");
          }
          setProgress('Connection lost — reconnecting…');
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        setPercent(current.progress_percent);

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
      setError(
        isNetworkError(err)
          ? "Can't reach the server. Check your connection and try again."
          : err instanceof Error ? err.message : 'Export failed',
      );
    } finally {
      setExporting(false);
      exportIdRef.current = null;
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-panel px-2 sm:gap-3 sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <IconButton label="Back to projects" onClick={onBack}>
            <ArrowLeft aria-hidden className="h-4 w-4" />
          </IconButton>
        )}
        <LogoMark className="hidden h-5 w-5 text-accent sm:block" />
        <h1 className="truncate text-sm font-semibold" title={project?.name}>{project?.name ?? APP_NAME}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {error && (
          <button
            type="button"
            role="alert"
            className="flex max-w-[35vw] items-center gap-1 truncate rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10 sm:max-w-xs"
            title="Dismiss"
            onClick={() => setError('')}
          >
            <span className="truncate">{error}</span>
            <XCircle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          </button>
        )}
        {progress && !error && !exporting && <span className="hidden text-xs tabular-nums text-fg-muted sm:block" role="status">{progress}</span>}
        {downloadUrl && !exporting && (
          <Button
            aria-label="Download export"
            onClick={() => downloadExport(downloadUrl).catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))}
          >
            <Download aria-hidden className="h-4 w-4 text-success" />
            <span className="hidden sm:inline">Download</span>
          </Button>
        )}

        <div className="flex items-center">
          <IconButton label="Undo" title="Undo (Ctrl+Z)" onClick={() => commandManager.undo()}>
            <Undo2 aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={() => commandManager.redo()}>
            <Redo2 aria-hidden className="h-4 w-4" />
          </IconButton>
          <AnimatedThemeToggler className="h-8 w-8 rounded-md" />
        </div>

        {exporting ? (
          <Button variant="dangerOutline" aria-label="Cancel export" onClick={cancelExport}>
            <XCircle aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
        ) : (
          <Button variant="primary" aria-label={error ? 'Retry export' : 'Export'} onClick={handleExport}>
            <Upload aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">{error ? 'Retry export' : 'Export'}</span>
          </Button>
        )}
      </div>
      {exporting && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-3 bottom-3 z-40 flex animate-pop-in items-center gap-4 rounded-2xl border border-border bg-raised p-3 pr-4 shadow-menu sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-14 sm:w-80"
        >
          <LottieIllustration name="rendering" className="h-20 w-20 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Exporting video</p>
            <p className="mt-0.5 truncate text-xs tabular-nums text-fg-muted">{progress || 'Starting…'}</p>
            <div
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink/10"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(3, percent)}%` }} />
            </div>
            <button type="button" onClick={cancelExport} className="mt-2 text-xs font-semibold text-fg-muted hover:text-danger">
              Cancel
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
