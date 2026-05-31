import { ArrowLeft, Download, Loader2, Scissors, Undo2, Redo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import { commandManager } from '../shared/UndoHistory';

interface Props { onBack?(): void }

interface ExportJob {
  id: string;
  status: string;
  progress_percent: number;
  output_url: string | null;
}

export function TopBar({ onBack }: Props) {
  const project = useProjectStore((s) => s.project);
  const [exporting, setExporting] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [error, setError]         = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleExport = async () => {
    if (!project) { setError('Open a project first'); return; }
    setExporting(true);
    setExportJob(null);
    setError('');
    stopPolling();

    try {
      const job = await api<ExportJob>(`/projects/${project.id}/exports`, {
        method: 'POST',
        body: JSON.stringify({
          format: 'mp4',
          resolution: '1080p',
          quality: 'standard',
          idempotency_key: `export-${project.id}-${Date.now()}`,
        }),
      });
      setExportJob(job);

      // Poll every 2s until completed / failed
      pollRef.current = setInterval(async () => {
        try {
          const updated = await api<ExportJob>(`/exports/${job.id}`);
          setExportJob(updated);
          if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled') {
            stopPolling();
            setExporting(false);
          }
        } catch { stopPolling(); setExporting(false); }
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setExporting(false);
    }
  };

  const status = exportJob?.status;
  const pct    = exportJob?.progress_percent ?? 0;
  const done   = status === 'completed' && exportJob?.output_url;

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
        {error && <span className="text-xs text-red-400">{error}</span>}

        {/* Export progress */}
        {exporting && exportJob && !done && (
          <span className="text-xs text-slate-400 tabular-nums">
            {status} {pct}%
          </span>
        )}

        {/* Download button when ready */}
        {done && exportJob.output_url && (
          <a
            href={exportJob.output_url}
            download
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        )}

        <button title="Undo (Ctrl+Z)" className="rounded border border-border p-2 hover:bg-white/5" onClick={() => commandManager.undo()}>
          <Undo2 className="h-4 w-4" />
        </button>
        <button title="Redo (Ctrl+Shift+Z)" className="rounded border border-border p-2 hover:bg-white/5" onClick={() => commandManager.redo()}>
          <Redo2 className="h-4 w-4" />
        </button>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {exporting ? `${pct}%` : 'Export'}
        </button>
      </div>
    </div>
  );
}
