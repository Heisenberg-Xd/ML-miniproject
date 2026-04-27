import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Webhook, Copy, Check, Zap, ArrowRight,
  CheckCircle, XCircle, Loader2, ExternalLink,
} from 'lucide-react';
import { getAuthHeaders } from '../utils/api';

const API_URL = import.meta.env.VITE_API_URL;

interface WebhookCardProps {
  workspaceId: number;
}

// Sample test payload — realistic-looking but minimal
const TEST_PAYLOAD = {
  records: [
    { customer_id: 'TEST-001', transaction_date: new Date().toISOString().split('T')[0], amount: 150.00 },
    { customer_id: 'TEST-002', transaction_date: new Date().toISOString().split('T')[0], amount: 320.50 },
    { customer_id: 'TEST-003', transaction_date: new Date().toISOString().split('T')[0], amount: 89.99 },
  ],
};

const STEPS = [
  { number: '1', label: 'Copy your webhook URL below' },
  { number: '2', label: 'Paste it into your app, Zapier, or Make' },
  { number: '3', label: 'Customer data syncs to your dashboard instantly' },
];

const TOOLS = [
  { name: 'Zapier', icon: '⚡', href: 'https://zapier.com' },
  { name: 'Make', icon: '🔗', href: 'https://make.com' },
  { name: 'n8n', icon: '🤖', href: 'https://n8n.io' },
];

export const WebhookCard: React.FC<WebhookCardProps> = ({ workspaceId }) => {
  const webhookUrl = `${API_URL}/api/integrations/webhook/${workspaceId}`;

  const [copied, setCopied]       = useState(false);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback for non-secure contexts
      const el = document.createElement('textarea');
      el.value = webhookUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_PAYLOAD),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.status === 'success')) {
        setTestResult({ ok: true, message: 'Data received successfully! Your dashboard will update shortly.' });
      } else {
        setTestResult({ ok: false, message: data.error || data.message || 'Test failed. Check your network or try again.' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Could not reach the server. Make sure the backend is running.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Webhook className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">Real-time Data Sync</h3>
          <p className="text-sm text-neutral-400 mt-0.5 leading-relaxed">
            Automatically send customer data from your apps into Cue-X in real time. No manual uploads needed.
          </p>
        </div>
      </div>

      {/* Step-by-step guide */}
      <div className="space-y-2.5">
        {STEPS.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-semibold text-neutral-400">{step.number}</span>
            </div>
            <span className="text-sm text-neutral-300">{step.label}</span>
            {i < STEPS.length - 1 && (
              <ArrowRight className="w-3.5 h-3.5 text-neutral-600 ml-auto flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Webhook URL block */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Your Webhook URL</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0 animate-pulse" />
            <code className="text-xs text-purple-300 truncate flex-1">{webhookUrl}</code>
          </div>
          <button
            onClick={handleCopy}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
              copied
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Test webhook button */}
      <div className="space-y-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/40 text-purple-300 hover:text-purple-200 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {testing ? 'Sending test data…' : 'Send Test Data'}
        </button>

        {/* Test result */}
        <AnimatePresence>
          {testResult && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex items-start gap-2.5 p-3 rounded-xl border text-sm ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/20 text-red-300'
              }`}
            >
              {testResult.ok
                ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : <XCircle    className="w-4 h-4 mt-0.5 flex-shrink-0" />
              }
              <span>{testResult.message}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* No-code tools */}
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 font-medium">
          🪄 No coding? Connect your favourite tools:
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {TOOLS.map(tool => (
            <a
              key={tool.name}
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-neutral-300 hover:text-white transition-all"
            >
              <span>{tool.icon}</span>
              {tool.name}
              <ExternalLink className="w-3 h-3 text-neutral-600" />
            </a>
          ))}
        </div>
        <p className="text-xs text-neutral-600">
          These automation tools let you send data from Shopify, Notion, Airtable, Google Sheets, and 5,000+ other apps — no code required.
        </p>
      </div>
    </motion.div>
  );
};
