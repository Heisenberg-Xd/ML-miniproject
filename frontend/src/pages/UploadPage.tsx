import { useState, useEffect, useId } from 'react';
import type { DragEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Play,
  Download,
  FileSpreadsheet,
  Link2,
  Database,
  ChevronRight,
} from 'lucide-react';
import { AppBackground } from '../components/ui/AppBackground';
import { WorkspaceSelector } from '../components/WorkspaceSelector';
import { DatasetSelector } from '../components/DatasetSelector';
import { DataSourcesPanel } from '../components/DataSourcesPanel';
import { WebhookCard } from '../components/WebhookCard';
import { fetchWithAuth } from '../utils/api';
import { LogoutButton } from '../components/LogoutButton';

const UploadPage = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(() => {
    const saved = localStorage.getItem('cuex_workspace_id');
    return saved ? parseInt(saved) : null;
  });

  const [showSheetConnect, setShowSheetConnect] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [isConnectingSheet, setIsConnectingSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWorkspaceId) {
      localStorage.setItem('cuex_workspace_id', selectedWorkspaceId.toString());
    }
  }, [selectedWorkspaceId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !selectedWorkspaceId) {
      setError(selectedWorkspaceId ? 'Please select a file' : 'Please select a workspace');
      return;
    }

    setIsLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace_id', selectedWorkspaceId.toString());

    try {
      const response = await fetchWithAuth('/upload', { 
        method: 'POST', 
        body: formData 
      });
      const data = await response.json();
      if (response.ok) {
        window.location.href = `/dashboard/${data.dataset_id}`;
      } else {
        const details = data?.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
        setError(`${data.error || 'Upload failed'}${details}`);
      }
    } catch (error) {
      console.error("[API ERROR]", error);
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleConnectSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl || !selectedWorkspaceId) return;

    setIsConnectingSheet(true);
    setSheetError(null);
    try {
      const response = await fetchWithAuth('/api/integrations/google-sheets/connect', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: selectedWorkspaceId, sheet_url: sheetUrl })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setShowSheetConnect(false);
        setSheetUrl('');
        window.location.reload();
      } else {
        setSheetError(data.error || 'Failed to connect sheet');
      }
    } catch {
      setSheetError('Network error connecting sheet');
    } finally {
      setIsConnectingSheet(false);
    }
  };

  return (
    <div className="relative min-h-screen scroll-smooth bg-[#050505] text-neutral-200 font-sans selection:bg-white/20 antialiased">
      <AppBackground />

      <div className="fixed top-6 right-6 z-20">
        <LogoutButton />
      </div>

      <main className="relative z-10 max-w-3xl w-full mx-auto px-4 sm:px-6 pt-24 pb-28 sm:pb-32">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-14 sm:mb-16"
        >
          <h1 className="font-cuex-serif text-[2.125rem] sm:text-5xl md:text-[3.25rem] font-semibold text-white tracking-tight text-balance leading-[1.08]">
            Workspace &amp; Data
          </h1>
          <p className="mt-4 sm:mt-5 text-neutral-500 text-base sm:text-lg font-sans font-normal leading-relaxed max-w-2xl mx-auto text-pretty">
            Select a workspace to upload new data or view existing analysis.
          </p>
        </motion.header>

        <section className="rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8">
          <WorkspaceSelector selectedWorkspaceId={selectedWorkspaceId} onWorkspaceSelect={setSelectedWorkspaceId} />
        </section>

        <AnimatePresence mode="wait">
          {selectedWorkspaceId ? (
            <motion.div
              key="workspace-flow"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mt-12 sm:mt-14 space-y-10 sm:space-y-12"
            >
              {/* Progress context */}
              <nav
                className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-neutral-500"
                aria-label="Setup steps"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-300/90 px-2.5 py-1 font-medium border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden />
                  Workspace
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-neutral-600 hidden sm:block" aria-hidden />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-medium text-neutral-300 border border-white/10">
                  Add data
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-neutral-600 hidden sm:block" aria-hidden />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-medium text-neutral-400 border border-white/5">
                  Connect &amp; explore
                </span>
              </nav>

              {/* Add data */}
              <section
                className="rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 sm:p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                aria-labelledby="add-data-heading"
              >
                <div className="flex items-start gap-3 mb-6">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                    <FileSpreadsheet className="w-5 h-5 text-neutral-300" strokeWidth={1.5} aria-hidden />
                  </div>
                  <div>
                    <h2 id="add-data-heading" className="text-lg font-semibold text-white tracking-tight">
                      Add data
                    </h2>
                    <p className="text-sm text-neutral-500 mt-1 leading-relaxed max-w-md">
                      CSV with customer id, purchase date, and amount. Prefer trying first? Grab the sample file, then drop it here.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <div className="flex items-center gap-3 min-w-0">
                    <Download className="w-4 h-4 text-neutral-500 shrink-0" strokeWidth={1.5} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-200">Sample CSV</p>
                      <p className="text-xs text-neutral-500 truncate">StyleSense_Dataset_updated.csv</p>
                    </div>
                  </div>
                  <a
                    href="/samples/StyleSense_Dataset_updated.csv"
                    download="StyleSense_Dataset_updated.csv"
                    className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 transition-colors"
                  >
                    Download
                  </a>
                </div>

                <form onSubmit={handleUpload} className="space-y-6">
                  <label
                    htmlFor={fileInputId}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={[
                      'group relative flex min-h-[240px] sm:min-h-[260px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] focus-visible:ring-cyan-500/50',
                      isDragging
                        ? 'border-cyan-400/50 bg-cyan-500/[0.07] scale-[1.01]'
                        : file
                          ? 'border-white/20 bg-white/[0.04]'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/18 hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    <input
                      id={fileInputId}
                      type="file"
                      className="sr-only"
                      accept=".csv"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <div className="flex flex-col items-center text-center z-10 max-w-sm">
                      <div
                        className={[
                          'mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-300',
                          file
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.04] text-neutral-400 group-hover:border-white/20 group-hover:text-white',
                        ].join(' ')}
                      >
                        <Upload className="w-7 h-7" strokeWidth={1.5} aria-hidden />
                      </div>
                      <p className="text-base font-medium text-white mb-1">
                        {file ? file.name : 'Drop your CSV here'}
                      </p>
                      <p className="text-sm text-neutral-500 leading-relaxed">
                        {file
                          ? 'Looks good — run processing when you’re ready.'
                          : 'Or click to browse. One file at a time.'}
                      </p>
                      {!file && (
                        <p className="mt-3 text-[11px] text-neutral-600">Accepted: .csv</p>
                      )}
                    </div>
                  </label>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        role="alert"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden rounded-xl border border-red-500/25 bg-red-950/30 px-4 py-3 text-left"
                      >
                        <pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm text-red-300/95">
                          {error}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-1">
                    <p className="text-xs text-neutral-600 order-2 sm:order-1">
                      Upload sends data to this workspace only.
                    </p>
                    <button
                      type="submit"
                      disabled={!file || isLoading}
                      className="order-1 sm:order-2 inline-flex h-12 min-w-[200px] items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-black shadow-lg shadow-black/20 transition-all hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      {isLoading ? (
                        <>
                          <span className="h-4 w-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                          Processing…
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-black" strokeWidth={1.5} aria-hidden />
                          Process dataset
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              {/* Integrations */}
              <section
                className="rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
                aria-labelledby="sources-heading"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                      <Link2 className="w-5 h-5 text-neutral-300" strokeWidth={1.5} aria-hidden />
                    </div>
                    <div>
                      <h2 id="sources-heading" className="text-lg font-semibold text-white tracking-tight">
                        Connected sources
                      </h2>
                      <p className="text-sm text-neutral-500 mt-1 max-w-md leading-relaxed">
                        Sheets, webhooks, and sync — keep this workspace fed without re-uploading.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSheetConnect(!showSheetConnect)}
                    className="shrink-0 self-start rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 transition-colors"
                  >
                    {showSheetConnect ? 'Close sheet form' : '+ Google Sheet'}
                  </button>
                </div>

                <AnimatePresence>
                  {showSheetConnect && (
                    <motion.form
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25 }}
                      className="mb-8 space-y-3 rounded-xl border border-white/[0.06] bg-black/25 p-4 sm:p-5"
                      onSubmit={handleConnectSheet}
                    >
                      <p className="text-sm text-neutral-400 leading-relaxed">
                        Public sheet URL — sharing must allow <span className="text-neutral-300">Anyone with the link can view</span>.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="url"
                          placeholder="https://docs.google.com/spreadsheets/d/…"
                          className="min-h-[44px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                          value={sheetUrl}
                          onChange={(e) => setSheetUrl(e.target.value)}
                          required
                        />
                        <button
                          type="submit"
                          disabled={isConnectingSheet}
                          className="min-h-[44px] shrink-0 rounded-lg bg-cyan-500 px-5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                        >
                          {isConnectingSheet ? 'Connecting…' : 'Connect'}
                        </button>
                      </div>
                      {sheetError && <p className="text-xs text-red-400">{sheetError}</p>}
                    </motion.form>
                  )}
                </AnimatePresence>

                <div className="space-y-6">
                  <WebhookCard workspaceId={selectedWorkspaceId} />
                  <DataSourcesPanel workspaceId={selectedWorkspaceId} />
                </div>
              </section>

              {/* Datasets */}
              <section
                className="rounded-2xl sm:rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
                aria-labelledby="datasets-section"
              >
                <div className="flex items-start gap-3 mb-6">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                    <Database className="w-5 h-5 text-neutral-300" strokeWidth={1.5} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id="datasets-section" className="text-lg font-semibold text-white tracking-tight">
                      Your datasets
                    </h2>
                    <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
                      Open analytics or delete a dataset from this workspace.
                    </p>
                  </div>
                </div>
                <DatasetSelector workspaceId={selectedWorkspaceId} embedded />
              </section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default UploadPage;
