import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Link2, FileSpreadsheet, Webhook, RefreshCw,
  Trash2, ToggleLeft, ToggleRight, Clock, AlertCircle,
  CheckCircle, Loader2, Wifi, WifiOff,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface DataSource {
  id: number;
  source_type: 'manual' | 'google_sheets' | 'webhook';
  config: Record<string, string>;
  is_active: boolean;
  auto_sync_enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
}

interface DataSourcesPanelProps {
  workspaceId: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0)  return `${mins}m ago`;
  return 'Just now';
}

function sourceIcon(type: string) {
  if (type === 'google_sheets') return <FileSpreadsheet className="w-4 h-4" />;
  if (type === 'webhook')       return <Webhook className="w-4 h-4" />;
  return <Link2 className="w-4 h-4" />;
}

function sourceLabel(type: string): string {
  if (type === 'google_sheets') return 'Google Sheets';
  if (type === 'webhook')       return 'Webhook';
  return 'Manual Upload';
}

function sourceBadgeClass(type: string): string {
  if (type === 'google_sheets') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (type === 'webhook')       return 'bg-purple-500/10  text-purple-400  border-purple-500/20';
  return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
}

// ── Source Card ────────────────────────────────────────────────────────────────
function SourceCard({
  source,
  onToggleSync,
  onRefresh,
  onDisconnect,
}: {
  source: DataSource;
  onToggleSync: (id: number, enabled: boolean) => void;
  onRefresh:    (id: number) => void;
  onDisconnect: (id: number) => void;
}) {
  const [syncing,    setSyncing]    = useState(false);
  const [toggling,   setToggling]   = useState(false);
  const [removing,   setRemoving]   = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const canRefresh = source.source_type === 'google_sheets';

  const handleRefresh = async () => {
    setSyncing(true);
    setSyncResult(null);
    await onRefresh(source.id);
    setSyncing(false);
    setSyncResult('Sync complete!');
    setTimeout(() => setSyncResult(null), 3000);
  };

  const handleToggle = async () => {
    setToggling(true);
    await onToggleSync(source.id, !source.auto_sync_enabled);
    setToggling(false);
  };

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect this ${sourceLabel(source.source_type)} source? Existing datasets will be preserved.`)) return;
    setRemoving(true);
    await onDisconnect(source.id);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: removing ? 0 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="glass-card rounded-2xl p-5 space-y-4"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${sourceBadgeClass(source.source_type)}`}>
            {sourceIcon(source.source_type)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{sourceLabel(source.source_type)}</p>
            {source.config?.sheet_url && (
              <p className="text-xs text-neutral-500 truncate max-w-[220px]">{source.config.sheet_url}</p>
            )}
            {source.config?.original_filename && (
              <p className="text-xs text-neutral-500 truncate">{source.config.original_filename}</p>
            )}
            {source.config?.endpoint && (
              <p className="text-xs font-mono text-neutral-500 truncate">{source.config.endpoint}</p>
            )}
          </div>
        </div>

        {/* Status pill */}
        <span className={`flex-shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
          source.is_active
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-neutral-800 text-neutral-500 border-neutral-700'
        }`}>
          {source.is_active ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {source.is_active ? 'Active' : 'Paused'}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {source.last_synced_at ? `Synced ${timeAgo(source.last_synced_at)}` : 'Never synced'}
        </span>
        {source.auto_sync_enabled && (
          <span className="flex items-center gap-1.5 text-cyan-500">
            <CheckCircle className="w-3 h-3" />
            Auto-sync on
          </span>
        )}
      </div>

      {/* Sync result toast */}
      <AnimatePresence>
        {syncResult && (
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-xs text-emerald-400 flex items-center gap-1.5"
          >
            <CheckCircle className="w-3 h-3" /> {syncResult}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {/* Auto-sync toggle — only for google_sheets */}
        {source.source_type === 'google_sheets' && (
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={source.auto_sync_enabled ? 'Disable auto-sync' : 'Enable auto-sync'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-neutral-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
          >
            {toggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : source.auto_sync_enabled ? (
              <ToggleRight className="w-4 h-4 text-cyan-400" />
            ) : (
              <ToggleLeft className="w-4 h-4" />
            )}
            Auto Sync
          </button>
        )}

        {/* Refresh Now */}
        {canRefresh && (
          <button
            onClick={handleRefresh}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-neutral-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {syncing ? 'Syncing…' : 'Refresh Now'}
          </button>
        )}

        {/* Disconnect */}
        {source.source_type !== 'manual' && (
          <button
            onClick={handleDisconnect}
            disabled={removing}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
          >
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Disconnect
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────
export const DataSourcesPanel: React.FC<DataSourcesPanelProps> = ({ workspaceId }) => {
  const [sources,   setSources]   = useState<DataSource[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetchWithAuth(`/api/integrations/sources?workspace_id=${workspaceId}`);
      if (res.ok) setSources(await res.json());
      else setError('Failed to load sources.');
    } catch (err) {
      console.error("[API ERROR] Network error loading sources:", err);
      setError('Network error loading sources.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleToggleSync = async (sourceId: number, enabled: boolean) => {
    try {
      await fetchWithAuth(`/api/integrations/${sourceId}/toggle-sync`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      setSources(prev =>
        prev.map(s => s.id === sourceId ? { ...s, auto_sync_enabled: enabled } : s)
      );
    } catch (err) {
      console.error("[API ERROR] Failed to toggle sync:", err);
    }
  };

  const handleRefresh = async (sourceId: number) => {
    try {
      await fetchWithAuth(`/api/integrations/${sourceId}/refresh`, { method: 'POST' });
      await fetchSources();
    } catch (err) {
      console.error("[API ERROR] Failed to refresh source:", err);
    }
  };

  const handleDisconnect = async (sourceId: number) => {
    try {
      await fetchWithAuth(`/api/integrations/${sourceId}`, { method: 'DELETE' });
      setSources(prev => prev.filter(s => s.id !== sourceId));
    } catch (err) {
      console.error("[API ERROR] Failed to disconnect source:", err);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-neutral-500 text-sm py-4">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading sources…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 text-sm py-4">
      <AlertCircle className="w-4 h-4" /> {error}
    </div>
  );

  const nonManual = sources.filter(s => s.source_type !== 'manual');

  if (nonManual.length === 0) return (
    <div className="py-6 text-center border border-dashed border-white/10 rounded-2xl">
      <p className="text-sm text-neutral-500">No connected sources yet.</p>
      <p className="text-xs text-neutral-600 mt-1">Connect a Google Sheet or Webhook below.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {nonManual.map(source => (
          <SourceCard
            key={source.id}
            source={source}
            onToggleSync={handleToggleSync}
            onRefresh={handleRefresh}
            onDisconnect={handleDisconnect}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
