import React, { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Check, Trash2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface Workspace {
  id: number;
  name: string;
  created_at: string;
}

interface WorkspaceSelectorProps {
  onWorkspaceSelect: (id: number) => void;
  selectedWorkspaceId: number | null;
}

// ── Minimal toast state ───────────────────────────────────────────────────────
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let toastCounter = 0;

// ── Confirmation Modal ────────────────────────────────────────────────────────
interface ConfirmModalProps {
  workspace: Workspace;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ workspace, isDeleting, onConfirm, onCancel }) => {
  const [confirmText, setConfirmText] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !isDeleting && onCancel()} />
      <div className="relative z-10 w-full max-w-md bg-neutral-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white">Delete Workspace?</h2>
            <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
              This will permanently delete <span className="text-white font-medium">"{workspace.name}"</span> and ALL of its datasets, customer records, and analytics. This action cannot be undone.
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="ml-auto flex-shrink-0 text-neutral-600 hover:text-neutral-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-neutral-400 mb-2">
            Please type <span className="text-white font-mono">{workspace.name}</span> to confirm.
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-red-500/50 transition-colors text-white"
            placeholder={workspace.name}
            disabled={isDeleting}
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting || confirmText !== workspace.name}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 border border-red-500/50 transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {isDeleting ? 'Deleting...' : 'Delete Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ onWorkspaceSelect, selectedWorkspaceId }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setWorkspaces(data);
      }
    } catch (err) {
      console.error("Failed to fetch workspaces", err);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/workspaces/${pendingDeleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        setWorkspaces(prev => prev.filter(w => w.id !== pendingDeleteId));
        showToast('Workspace deleted successfully', 'success');

        // If the user deleted the currently active workspace, clear their selection
        if (selectedWorkspaceId === pendingDeleteId) {
          onWorkspaceSelect(null as unknown as number); // The app will handle null/clearing
        }

        setPendingDeleteId(null);
      } else {
        showToast(data.error || 'Failed to delete workspace', 'error');
      }
    } catch {
      showToast('Failed to delete workspace', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const pendingWorkspace = workspaces.find(w => w.id === pendingDeleteId);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setCreateError(null);
    setIsLoading(true);
    try {
      const res = await fetchWithAuth('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWorkspaceName.trim() })
      });
      let data: { error?: string; workspace_id?: number } = {};
      try {
        data = await res.json();
      } catch {
        setCreateError(`Request failed (${res.status}). Check that the API is running.`);
        return;
      }
      if (res.ok && data.workspace_id != null) {
        setNewWorkspaceName('');
        setIsCreating(false);
        await fetchWorkspaces();
        onWorkspaceSelect(data.workspace_id);
      } else {
        setCreateError(data.error || `Could not create workspace (${res.status}).`);
      }
    } catch (err) {
      console.error("Failed to create workspace", err);
      setCreateError('Network error — check the browser console and that the API is reachable.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl text-sm font-medium shadow-xl border pointer-events-auto transition-all ${t.type === 'success'
              ? 'bg-emerald-900/80 border-emerald-500/30 text-emerald-300'
              : 'bg-red-900/80 border-red-500/30 text-red-300'
              }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Confirmation Modal */}
      {pendingDeleteId && pendingWorkspace && (
        <ConfirmModal
          workspace={pendingWorkspace}
          isDeleting={isDeleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => !isDeleting && setPendingDeleteId(null)}
        />
      )}

      <div className="w-full max-w-2xl mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-neutral-400" />
            Workspace
          </h2>
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            {isCreating ? 'Cancel' : <><Plus className="w-3 h-3" /> Create New</>}
          </button>
        </div>

        {isCreating ? (
          <form onSubmit={handleCreateWorkspace} className="flex flex-col gap-2 mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {createError && (
              <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-xl px-3 py-2">{createError}</p>
            )}
            <div className="flex gap-2 w-full">
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Enter workspace name..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-white/20 transition-colors"
                autoFocus
              />
              <button
                type="submit"
                disabled={isLoading || !newWorkspaceName.trim()}
                className="bg-white text-black px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => onWorkspaceSelect(ws.id)}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 text-left ${selectedWorkspaceId === ws.id
                  ? 'bg-white/10 border-white/30 ring-1 ring-white/20'
                  : 'bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/[0.07]'
                  }`}
              >
                <div>
                  <div className="text-sm font-medium text-white">{ws.name}</div>
                  <div className="text-[10px] text-neutral-500 mt-1">
                    Created {new Date(ws.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteId(ws.id); }}
                    title="Delete workspace"
                    className="p-2 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {selectedWorkspaceId === ws.id && (
                    <Check className="w-4 h-4 text-blue-400" />
                  )}
                </div>
              </button>
            ))}
            {workspaces.length === 0 && !isCreating && (
              <div className="col-span-2 py-8 text-center border border-dashed border-white/10 rounded-2xl">
                <p className="text-sm text-neutral-500">No workspaces found. Create one to get started.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

