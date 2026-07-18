'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Palette,
  Building2,
  Tag,
  Globe2,
  Image as ImageIcon,
  MessageSquare,
  Bot,
  Save,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  User,
  Mail,
  Phone,
  Send,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { useApi, postJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

type BrandingConfig = {
  appName: string;
  codename: string;
  fullName: string;
  version: string;
  tagline: string;
  poweredBy: string;
  company: string;
  owner: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerTelegram: string;
  ownerTimezone: string;
  ownerEscalationMinutes: number;
  website: string;
  accentColor: string;
  logoUrl: string;
  chatTabLabel: string;
  metaTitle: string;
  metaDescription: string;
  systemPromptPreamble: string;
  footerNote: string;
};

type FieldGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  fields: { key: keyof BrandingConfig; label: string; placeholder: string; multiline?: boolean; numeric?: boolean }[];
};

const GROUPS: FieldGroup[] = [
  {
    id: 'identity',
    label: 'Identity',
    icon: Sparkles,
    accent: JARVIS.colors.cyan,
    fields: [
      { key: 'appName', label: 'App Name', placeholder: 'ARIA' },
      { key: 'codename', label: 'Codename', placeholder: 'ARIA' },
      { key: 'fullName', label: 'Full Name', placeholder: 'Autonomous Responsive Intelligence Assistant' },
      { key: 'version', label: 'Version', placeholder: '10.0.0' },
    ],
  },
  {
    id: 'taglines',
    label: 'Taglines',
    icon: Tag,
    accent: JARVIS.colors.violet,
    fields: [
      { key: 'tagline', label: 'Tagline', placeholder: 'Powered by Liafon Software Private Limited' },
      { key: 'poweredBy', label: 'Powered By', placeholder: 'Powered by Liafon Software Private Limited' },
      { key: 'footerNote', label: 'Footer Note', placeholder: 'Powered by Liafon Software Private Limited · Owned by Raviteja Voruganti', multiline: true },
    ],
  },
  {
    id: 'company',
    label: 'Company',
    icon: Building2,
    accent: JARVIS.colors.green,
    fields: [
      { key: 'company', label: 'Company', placeholder: 'Liafon Software Private Limited' },
      { key: 'owner', label: 'Owner Name', placeholder: 'Raviteja Voruganti' },
      { key: 'website', label: 'Website', placeholder: 'https://liafon.com' },
    ],
  },
  {
    id: 'owner-contact',
    label: 'Owner Contact',
    icon: User,
    accent: JARVIS.colors.red,
    fields: [
      { key: 'ownerEmail', label: 'Owner Email', placeholder: 'raviteja@liafon.com' },
      { key: 'ownerPhone', label: 'Owner Phone', placeholder: '+919999999999' },
      { key: 'ownerTelegram', label: 'Owner Telegram', placeholder: '@raviteja' },
      { key: 'ownerTimezone', label: 'Owner Timezone', placeholder: 'Asia/Calcutta' },
      { key: 'ownerEscalationMinutes', label: 'Escalation Timeout (minutes)', placeholder: '30', numeric: true },
    ],
  },
  {
    id: 'visual',
    label: 'Visual',
    icon: ImageIcon,
    accent: JARVIS.colors.amber,
    fields: [
      { key: 'accentColor', label: 'Accent Color (hex)', placeholder: '#7DD3FC' },
      { key: 'logoUrl', label: 'Logo URL', placeholder: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg' },
    ],
  },
  {
    id: 'chat-meta',
    label: 'Chat & Metadata',
    icon: MessageSquare,
    accent: JARVIS.colors.cyan,
    fields: [
      { key: 'chatTabLabel', label: 'Chat Tab Label', placeholder: 'ARIA Chat' },
      { key: 'metaTitle', label: 'Meta Title', placeholder: 'ARIA Mission Control — Autonomous Agent Orchestration' },
      { key: 'metaDescription', label: 'Meta Description', placeholder: 'Short description for SEO…', multiline: true },
    ],
  },
  {
    id: 'agent-prompt',
    label: 'Agent Prompt',
    icon: Bot,
    accent: JARVIS.colors.red,
    fields: [
      { key: 'systemPromptPreamble', label: 'System Prompt Preamble', placeholder: 'You are ARIA…', multiline: true },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export default function BrandingTab() {
  const { data, refresh } = useApi<{ config: BrandingConfig; defaults: BrandingConfig }>('/api/branding', -1);
  const { toast } = useToast();
  const [edits, setEdits] = useState<Partial<BrandingConfig>>({});
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);

  // Patch-overlay pattern: defaults → server config → local edits.
  // We never setState-in-effect; the merged value is computed via useMemo.
  const merged: BrandingConfig = useMemo(() => {
    const base: BrandingConfig = {
      appName: 'ARIA',
      codename: 'ARIA',
      fullName: 'Autonomous Responsive Intelligence Assistant',
      version: '10.0.0',
      tagline: 'Powered by Liafon Software Private Limited',
      poweredBy: 'Powered by Liafon Software Private Limited',
      company: 'Liafon Software Private Limited',
      owner: 'Raviteja Voruganti',
      ownerEmail: 'raviteja@liafon.com',
      ownerPhone: '+919999999999',
      ownerTelegram: '@raviteja',
      ownerTimezone: 'Asia/Calcutta',
      ownerEscalationMinutes: 30,
      website: 'https://liafon.com',
      accentColor: '#7DD3FC',
      logoUrl: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg',
      chatTabLabel: 'ARIA Chat',
      metaTitle: 'ARIA Mission Control — Autonomous Agent Orchestration',
      metaDescription:
        'ARIA v10 — Autonomous Responsive Intelligence Assistant. A mission-control dashboard for an autonomous agent fleet.',
      systemPromptPreamble:
        'You are ARIA (Autonomous Responsive Intelligence Assistant), an autonomous agent-orchestration system powered by Liafon Software Private Limited. Maintain a calm, precise, mission-control tone.',
      footerNote: 'Powered by Liafon Software Private Limited · Owned by Raviteja Voruganti',
    };
    const srv = data?.config;
    if (srv) {
      for (const k of ALL_KEYS) {
        const v = (srv as Record<string, unknown>)[k];
        if (k === 'ownerEscalationMinutes') {
          if (typeof v === 'number' && v > 0) (base as Record<string, unknown>)[k] = v;
        } else if (typeof v === 'string' && v.length > 0) {
          (base as Record<string, unknown>)[k] = v;
        }
      }
    }
    for (const k of ALL_KEYS) {
      const v = edits[k];
      if (k === 'ownerEscalationMinutes') {
        if (typeof v === 'number' && v > 0) (base as Record<string, unknown>)[k] = v;
      } else if (typeof v === 'string') {
        (base as Record<string, unknown>)[k] = v;
      }
    }
    return base;
  }, [data, edits]);

  const dirty = Object.keys(edits).length > 0;

  const setField = (key: keyof BrandingConfig, value: string | number) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!dirty) return;
    setBusy('save');
    try {
      await postJson('/api/branding', edits);
      toast({ title: 'Branding saved', description: `${Object.keys(edits).length} field(s) updated` });
      setEdits({});
      refresh();
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      await deleteJson('/api/branding');
      toast({ title: 'Branding reset', description: 'Restored to ARIA defaults' });
      setEdits({});
      refresh();
    } catch (e) {
      toast({
        title: 'Reset failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Branding"
        icon={Palette}
        accent={JARVIS.colors.violet}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={reset}
              disabled={busy !== null}
              className="border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {busy === 'reset' ? 'Resetting…' : 'Reset'}
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || busy !== null}
              className="jarvis-btn-accent border-0"
            >
              {busy === 'save' ? (
                <>
                  <Save className="h-3.5 w-3.5 mr-1 animate-pulse" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save
                </>
              )}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live preview panel — left column on lg, full width on smaller */}
        <Card className="lg:col-span-1 p-4 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)] h-fit sticky top-4">
          <div className="flex items-center gap-2 mb-3">
            <Pill color={JARVIS.colors.cyan}>Live Preview</Pill>
            {dirty && <Pill color={JARVIS.colors.amber}>unsaved</Pill>}
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {merged.logoUrl ? (
                <img
                  src={merged.logoUrl}
                  alt={`${merged.appName} logo`}
                  className="h-10 w-10 rounded-md object-contain bg-[var(--j-panel-soft)] border border-[var(--j-border)] p-1"
                />
              ) : (
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-md font-bold text-sm"
                  style={{ background: `${merged.accentColor}1a`, border: `1px solid ${merged.accentColor}55`, color: merged.accentColor }}
                >
                  {merged.appName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-tight" style={{ color: merged.accentColor }}>
                  {merged.appName}
                </div>
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                  Mission Control v{merged.version}
                </div>
              </div>
            </div>
            <div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Full Name</div>
              <div className="text-xs text-[var(--j-text)]">{merged.fullName}</div>
            </div>
            <div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Tagline</div>
              <div className="text-xs text-[var(--j-text-dim)]">{merged.tagline}</div>
            </div>
            <div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Footer</div>
              <div className="text-[11px] text-[var(--j-text-dim)] jarvis-mono">{merged.footerNote}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Pill color={merged.accentColor}>{merged.codename}</Pill>
              <Pill color={JARVIS.colors.green}>{merged.chatTabLabel}</Pill>
              <Pill color={JARVIS.colors.amber}>{merged.company}</Pill>
            </div>
            <div className="pt-2 border-t border-[var(--j-border-soft)]">
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Meta Title</div>
              <div className="text-[11px] text-[var(--j-text-dim)] line-clamp-2">{merged.metaTitle}</div>
            </div>
            {/* Owner contact summary — shows the escalation-relevant details */}
            <div className="pt-2 border-t border-[var(--j-border-soft)] space-y-1.5">
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Owner Contact</div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-text-dim)]">
                <User className="h-3 w-3 text-[var(--j-text-mute)]" />
                <span className="truncate">{merged.owner}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-text-dim)]">
                <Mail className="h-3 w-3 text-[var(--j-text-mute)]" />
                <span className="truncate">{merged.ownerEmail}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-text-dim)]">
                <Phone className="h-3 w-3 text-[var(--j-text-mute)]" />
                <span className="truncate">{merged.ownerPhone}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-text-dim)]">
                <Send className="h-3 w-3 text-[var(--j-text-mute)]" />
                <span className="truncate">{merged.ownerTelegram}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-text-dim)]">
                <Clock className="h-3 w-3 text-[var(--j-text-mute)]" />
                <span>Escalates after {merged.ownerEscalationMinutes} min</span>
              </div>
            </div>
          </div>
        </Card>

        {/* 6 field-group cards — right two-thirds on lg */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {GROUPS.map((g, idx) => {
            const Icon = g.icon;
            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
              >
                <Card className="p-4 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)] h-full">
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md"
                      style={{ background: `${g.accent}1a`, border: `1px solid ${g.accent}33`, color: g.accent }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">{g.label}</h3>
                  </div>
                  <div className="space-y-3">
                    {g.fields.map((f) => (
                      <div key={f.key} className="space-y-1.5">
                        <Label htmlFor={`branding-${f.key}`} className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                          {f.label}
                        </Label>
                        {f.multiline ? (
                          <Textarea
                            id={`branding-${f.key}`}
                            value={String(merged[f.key] ?? '')}
                            onChange={(e) => setField(f.key, e.target.value)}
                            placeholder={f.placeholder}
                            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] min-h-[64px] text-xs"
                          />
                        ) : f.numeric ? (
                          <Input
                            id={`branding-${f.key}`}
                            type="number"
                            value={String(merged[f.key] ?? '')}
                            onChange={(e) => setField(f.key, parseInt(e.target.value, 10) || 0)}
                            placeholder={f.placeholder}
                            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
                          />
                        ) : (
                          <Input
                            id={`branding-${f.key}`}
                            value={String(merged[f.key] ?? '')}
                            onChange={(e) => setField(f.key, e.target.value)}
                            placeholder={f.placeholder}
                            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2 text-[11px] text-[var(--j-text-mute)] jarvis-mono uppercase">
          <Globe2 className="h-3.5 w-3.5" />
          {merged.website}
        </div>
        {!dirty && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--j-green)] jarvis-mono uppercase">
            <CheckCircle2 className="h-3.5 w-3.5" /> in sync with DB
          </div>
        )}
      </div>
    </div>
  );
}
