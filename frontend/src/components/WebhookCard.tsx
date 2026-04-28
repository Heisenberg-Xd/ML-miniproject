import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Webhook, Copy, Check, ArrowRight, ExternalLink, RefreshCw
} from 'lucide-react';

import { API_BASE } from '../config/api';

interface WebhookCardProps {
  workspaceId: number;
}

const STEPS = [
  { number: '1', label: 'Copy your webhook URL below' },
  { number: '2', label: 'Paste it into your app, Zapier, or Make' },
  { number: '3', label: 'Customer data syncs to your dashboard instantly' },
];

const TOOLS = [
  { name: 'Zapier', href: 'https://zapier.com' },
  { name: 'Make', href: 'https://make.com' },
  { name: 'n8n', href: 'https://n8n.io' },
];

export const WebhookCard: React.FC<WebhookCardProps> = ({ workspaceId }) => {
  const webhookUrl = `${API_BASE}/api/integrations/webhook/${workspaceId}`;

  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
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

  const handleRefresh = () => {
    setIsRefreshing(true);
    // In a real implementation, this would poll the backend for new datasets
    // For now, we'll just reload the page to fetch the latest data
    setTimeout(() => {
      window.location.reload();
    }, 500);
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
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Real-time Data Sync</h3>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-300 hover:text-white transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
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

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* No-code tools */}
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 font-medium">
          No coding? Connect your favourite tools:
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
