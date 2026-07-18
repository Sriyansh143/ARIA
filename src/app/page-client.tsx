'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, LayoutDashboard, Bot, MessageSquare, Sparkles, Database, Gauge,
  CalendarClock, Wallet, HeartPulse, ScrollText, ListTodo, History, FolderArchive,
  Network, Lightbulb, Bell, Search, Command, Menu, X, Cpu, MemoryStick, Zap,
  Radio, ChevronRight, ShieldCheck, CircleDot, LayoutGrid, MessagesSquare,
  Terminal, Sun, Moon, Share2, Workflow, Sliders, Eye, EyeOff, ChevronUp, ChevronDown, Pin, GitBranch, Rocket, BarChart3, Loader2, Star, FileText,
  Copy, DollarSign, Palette, GraduationCap,
  Building2, Gavel, Puzzle, Briefcase, Target,
  CreditCard, AlertCircle, AlertTriangle, CheckCircle, Keyboard,
} from 'lucide-react';
import { JARVIS, fmtTime } from '@/lib/config';
import { useApi } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNavStore } from '@/lib/nav-store';
import { MergedTab } from '@/components/jarvis/MergedTab';

import OrionShell from '@/components/jarvis/OrionShell';
import OverviewTab from '@/components/tabs/OverviewTab';
import FleetTab from '@/components/tabs/FleetTab';
import ChatTab from '@/components/tabs/ChatTab';
import SkillsTab from '@/components/tabs/SkillsTab';
import MemoryTab from '@/components/tabs/MemoryTab';
import TelemetryTab from '@/components/tabs/TelemetryTab';
import SchedulerTab from '@/components/tabs/SchedulerTab';
import PaymentsTab from '@/components/tabs/PaymentsTab';
import HealthTab from '@/components/tabs/HealthTab';
import LogsTab from '@/components/tabs/LogsTab';
import TasksTab from '@/components/tabs/TasksTab';
import ActivityTab from '@/components/tabs/ActivityTab';
import ArtifactsTab from '@/components/tabs/ArtifactsTab';
import ProvidersTab from '@/components/tabs/ProvidersTab';
import InsightsTab from '@/components/tabs/InsightsTab';
import KanbanTab from '@/components/tabs/KanbanTab';
import CommsTab from '@/components/tabs/CommsTab';
import SkillRunnerTab from '@/components/tabs/SkillRunnerTab';
import MemoryGraphTab from '@/components/tabs/MemoryGraphTab';
import FleetTopologyTab from '@/components/tabs/FleetTopologyTab';
import AgentNetworkTab from '@/components/tabs/AgentNetworkTab';
import SkillChainTab from '@/components/tabs/SkillChainTab';
import TaskDagTab from '@/components/tabs/TaskDagTab';
import AutonomyTab from '@/components/tabs/AutonomyTab';
import AnalyticsTab from '@/components/tabs/AnalyticsTab';
import ReportsTab from '@/components/tabs/ReportsTab';
import SpawnedAgentsTab from '@/components/tabs/SpawnedAgentsTab';
import EarningMethodsTab from '@/components/tabs/EarningMethodsTab';
import BrandingTab from '@/components/tabs/BrandingTab';
import PaymentMethodsTab from '@/components/tabs/PaymentMethodsTab';
import TeachSourceCard from '@/components/tabs/TeachSourceCard';
import WorkforceTab from '@/components/tabs/WorkforceTab';
import LearningTab from '@/components/tabs/LearningTab';
import RulesTab from '@/components/tabs/RulesTab';
import PluginsTab from '@/components/tabs/PluginsTab';
import ModelsTab from '@/components/tabs/ModelsTab';
import BlackboxTab from '@/components/tabs/BlackboxTab';
import ServicesHubTab from '@/components/tabs/ServicesHubTab';
import AppTreeTab from '@/components/tabs/AppTreeTab';
import GoalsTab from '@/components/tabs/GoalsTab';
import DataManagementTab from '@/components/tabs/DataManagementTab';
import AgentMonitorTab from '@/components/tabs/AgentMonitorTab';
import AuditLogTab from '@/components/tabs/AuditLogTab';
import CRMTab from '@/components/tabs/CRMTab';

// ─── Merged tab components (combine related tabs with sub-view toggles) ───

// Agent Fleet: Cards + Topology + Spawned + Workforce
function FleetMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.cyan}
      views={[
        { key: 'roster', label: 'Roster', component: <FleetTab /> },
        { key: 'topology', label: 'Topology', component: <FleetTopologyTab /> },
        { key: 'spawned', label: 'Spawned', component: <SpawnedAgentsTab /> },
        { key: 'workforce', label: 'Workforce', component: <WorkforceTab /> },
      ]}
    />
  );
}

// Tasks: List + Kanban + DAG
function TasksMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.amber}
      views={[
        { key: 'list', label: 'List', component: <TasksTab /> },
        { key: 'kanban', label: 'Kanban', component: <KanbanTab /> },
        { key: 'dag', label: 'DAG', component: <TaskDagTab /> },
      ]}
    />
  );
}

// Skills: Catalog + Runner + Pipeline
function SkillsMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.cyan}
      views={[
        { key: 'catalog', label: 'Catalog', component: <SkillsTab /> },
        { key: 'runner', label: 'Runner', component: <SkillRunnerTab /> },
        { key: 'pipeline', label: 'Pipeline', component: <SkillChainTab /> },
      ]}
    />
  );
}

// AI Models: Models + Providers
function ModelsMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.cyan}
      views={[
        { key: 'models', label: 'Models', component: <ModelsTab /> },
        { key: 'providers', label: 'Providers', component: <ProvidersTab /> },
      ]}
    />
  );
}

// Memory: Store + Graph
function MemoryMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.violet}
      views={[
        { key: 'store', label: 'Store', component: <MemoryTab /> },
        { key: 'graph', label: 'Graph', component: <MemoryGraphTab /> },
      ]}
    />
  );
}

// Learning: Learn & Earn (already includes TeachSourceCard embedded inside)
function LearningMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.cyan}
      views={[
        { key: 'learn', label: 'Learn & Earn', component: <LearningTab /> },
      ]}
    />
  );
}

// Rules & Plugins
function RulesPluginsMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.amber}
      views={[
        { key: 'rules', label: 'Rules', component: <RulesTab /> },
        { key: 'plugins', label: 'Plugins', component: <PluginsTab /> },
      ]}
    />
  );
}

// Fleet Health: Health + Telemetry
function HealthMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.green}
      views={[
        { key: 'health', label: 'Health', component: <HealthTab /> },
        { key: 'telemetry', label: 'Telemetry', component: <TelemetryTab /> },
      ]}
    />
  );
}

// Monitoring: Logs + Black Box + Agent Monitor + Audit
function MonitoringMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.red}
      views={[
        { key: 'agent-monitor', label: 'Monitors', component: <AgentMonitorTab /> },
        { key: 'logs', label: 'Logs', component: <LogsTab /> },
        { key: 'blackbox', label: 'Black Box', component: <BlackboxTab /> },
        { key: 'audit', label: 'Audit Log', component: <AuditLogTab /> },
      ]}
    />
  );
}

// Analytics & Reports
function AnalyticsReportsMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.cyan}
      views={[
        { key: 'analytics', label: 'Analytics', component: <AnalyticsTab /> },
        { key: 'reports', label: 'Reports', component: <ReportsTab /> },
      ]}
    />
  );
}

// Payments: Transactions + Payout Methods
function PaymentsMergedTab() {
  return (
    <MergedTab
      accent={JARVIS.colors.green}
      views={[
        { key: 'transactions', label: 'Transactions', component: <PaymentsTab /> },
        { key: 'methods', label: 'Payout Methods', component: <PaymentMethodsTab /> },
      ]}
    />
  );
}

export type TabKey =
  | 'overview' | 'chat' | 'activity' | 'insights'
  | 'fleet' | 'comms'
  | 'tasks' | 'goals'
  | 'skills' | 'autonomy' | 'models'
  | 'memory' | 'learning' | 'rules-plugins' | 'artifacts'
  | 'health' | 'monitoring' | 'scheduler'
  | 'payments' | 'earnings' | 'analytics' | 'services'
  | 'data-mgmt' | 'branding' | 'apptree'
  | 'crm'
  | 'agent-network';

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof Activity;
  group: string;
  accent: string;
}

const TABS: TabDef[] = [
  // ─── Command Center (4) ───
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Command', accent: JARVIS.colors.cyan },
  { key: 'chat', label: 'Command Center', icon: MessageSquare, group: 'Command', accent: JARVIS.colors.violet },
  { key: 'activity', label: 'Activity Feed', icon: History, group: 'Command', accent: JARVIS.colors.green },
  { key: 'insights', label: 'AI Insights', icon: Lightbulb, group: 'Command', accent: JARVIS.colors.cyan },

  // ─── Agent Fleet (3) — merged 5→2 + network viz ───
  { key: 'fleet', label: 'Agent Fleet', icon: Bot, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'agent-network', label: 'Agent Network', icon: Share2, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'comms', label: 'Agent Comms', icon: MessagesSquare, group: 'Fleet', accent: JARVIS.colors.violet },

  // ─── Work & Tasks (2) — merged 4→2 ───
  { key: 'tasks', label: 'Tasks', icon: ListTodo, group: 'Work', accent: JARVIS.colors.amber },
  { key: 'goals', label: 'Goals', icon: Target, group: 'Work', accent: JARVIS.colors.cyan },

  // ─── Intelligence (3) — merged 6→3 ───
  { key: 'skills', label: 'Skills', icon: Sparkles, group: 'Intelligence', accent: JARVIS.colors.cyan },
  { key: 'autonomy', label: 'Autonomy Loop', icon: Rocket, group: 'Intelligence', accent: JARVIS.colors.cyan },
  { key: 'models', label: 'AI Models', icon: Cpu, group: 'Intelligence', accent: JARVIS.colors.cyan },

  // ─── Knowledge Base (4) — merged 7→4 ───
  { key: 'memory', label: 'Memory', icon: Database, group: 'Knowledge', accent: JARVIS.colors.violet },
  { key: 'learning', label: 'Learning', icon: GraduationCap, group: 'Knowledge', accent: JARVIS.colors.cyan },
  { key: 'rules-plugins', label: 'Rules & Plugins', icon: Gavel, group: 'Knowledge', accent: JARVIS.colors.amber },
  { key: 'artifacts', label: 'Artifacts', icon: FolderArchive, group: 'Knowledge', accent: JARVIS.colors.amber },

  // ─── Monitoring & Ops (3) — merged 6→3 ───
  { key: 'health', label: 'Fleet Health', icon: HeartPulse, group: 'Monitoring', accent: JARVIS.colors.green },
  { key: 'monitoring', label: 'Monitoring', icon: ShieldCheck, group: 'Monitoring', accent: JARVIS.colors.red },
  { key: 'scheduler', label: 'Scheduler', icon: CalendarClock, group: 'Monitoring', accent: JARVIS.colors.violet },

  // ─── Business & Revenue (5) — merged 6→5 ───
  { key: 'payments', label: 'Payments', icon: Wallet, group: 'Business', accent: JARVIS.colors.green },
  { key: 'earnings', label: 'Earning Methods', icon: DollarSign, group: 'Business', accent: JARVIS.colors.green },
  { key: 'crm', label: 'CRM & Sales', icon: Briefcase, group: 'Business', accent: JARVIS.colors.amber },
  { key: 'analytics', label: 'Analytics & Reports', icon: BarChart3, group: 'Business', accent: JARVIS.colors.cyan },
  { key: 'services', label: 'Services Hub', icon: Briefcase, group: 'Business', accent: JARVIS.colors.amber },

  // ─── System & Admin (3) ───
  { key: 'data-mgmt', label: 'Data Management', icon: Database, group: 'System', accent: JARVIS.colors.amber },
  { key: 'branding', label: 'Branding', icon: Palette, group: 'System', accent: JARVIS.colors.violet },
  { key: 'apptree', label: 'App Tree', icon: FolderArchive, group: 'System', accent: JARVIS.colors.cyan },
];

/**
 * Explicit sidebar group order + accent color per group.
 * Information architecture: Command → Fleet → Work → Intelligence
 * → Knowledge → Monitoring → Business → System.
 */
const SIDEBAR_GROUPS: { key: string; label: string; accent: string }[] = [
  { key: 'Command', label: 'Command Center', accent: JARVIS.colors.cyan },
  { key: 'Fleet', label: 'Agent Fleet', accent: JARVIS.colors.cyan },
  { key: 'Work', label: 'Work & Tasks', accent: JARVIS.colors.amber },
  { key: 'Intelligence', label: 'Intelligence', accent: JARVIS.colors.violet },
  { key: 'Knowledge', label: 'Knowledge Base', accent: JARVIS.colors.violet },
  { key: 'Monitoring', label: 'Monitoring & Ops', accent: JARVIS.colors.red },
  { key: 'Business', label: 'Business & Revenue', accent: JARVIS.colors.green },
  { key: 'System', label: 'System & Admin', accent: JARVIS.colors.amber },
];

const TAB_MAP: Record<TabKey, () => JSX.Element> = {
  // Command
  overview: OverviewTab,
  chat: ChatTab,
  activity: ActivityTab,
  insights: InsightsTab,
  // Fleet (merged)
  fleet: FleetMergedTab,
  'agent-network': AgentNetworkTab,
  comms: CommsTab,
  // Work (merged)
  tasks: TasksMergedTab,
  goals: GoalsTab,
  // Intelligence (merged)
  skills: SkillsMergedTab,
  autonomy: AutonomyTab,
  models: ModelsMergedTab,
  // Knowledge (merged)
  memory: MemoryMergedTab,
  learning: LearningMergedTab,
  'rules-plugins': RulesPluginsMergedTab,
  artifacts: ArtifactsTab,
  // Monitoring (merged)
  health: HealthMergedTab,
  monitoring: MonitoringMergedTab,
  scheduler: SchedulerTab,
  // Business (merged)
  payments: PaymentsMergedTab,
  earnings: EarningMethodsTab,
  crm: CRMTab,
  analytics: AnalyticsReportsMergedTab,
  services: ServicesHubTab,
  // System
  'data-mgmt': DataManagementTab,
  branding: BrandingTab,
  apptree: AppTreeTab,
};

interface MetricsData {
  current: { cpu: number; mem: number; disk: number; latency: number; tokens: number; uptime: number };
}

export default function MissionControlDashboard() {
  // Single source of truth for the active tab is the global nav store,
  // so any component (StatCard, Orion voice command, agent alerts, …) can
  // navigate without prop-drilling. The shell subscribes here.
  const tab = useNavStore((s) => s.tab as TabKey);
  const navigateStore = useNavStore((s) => s.navigate);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteKey, setPaletteKey] = useState(0);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [manageOpen, setManageOpen] = useState(false);
  // Keyboard shortcuts overlay (press `?`).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Tab personalization: hidden tabs + pinned tabs + custom order.
  const [tabPrefs, setTabPrefs] = useState<{ hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] }>({ hidden: [], pinned: [], order: [] });
  // Orion voice-shell overlay mode (persisted). When true, a full-screen
  // voice-first interface replaces the dashboard.
  const [orionMode, setOrionMode] = useState(false);

  const { data: metrics } = useApi<MetricsData>('/api/metrics', 8000);
  const { data: commsData } = useApi<{ unread: number }>('/api/comms', 15000);
  const commsUnread = commsData?.unread ?? 0;

  // Branding — fetch once on mount (-1 = no polling). Drives the header
  // app-name, version, footer powered-by, and chat-tab label.
  const { data: brandingData } = useApi<{
    config: {
      appName: string;
      version: string;
      poweredBy?: string;
      chatTabLabel?: string;
      footerNote?: string;
    };
    defaults: { appName: string; version: string };
  }>('/api/branding', -1);
  const branding = brandingData?.config;
  const appName = branding?.appName || 'JARVIS';
  const appVersion = branding?.version || brandingData?.defaults.version || JARVIS.version;
  const appPoweredBy = branding?.poweredBy || '';
  const appCompany = branding?.company || 'Liafon Software Private Limited';
  const chatTabLabel = branding?.chatTabLabel || 'JARVIS Chat';
  const footerNote = branding?.footerNote || '';

  // Resolve a tab's display label — chat label is driven by branding config.
  const tabLabelOf = useCallback((t: TabDef) => (t.key === 'chat' ? chatTabLabel : t.label), [chatTabLabel]);

  // Theme: load persisted preference on mount, default dark.
  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('jarvis-theme')) as 'dark' | 'light' | null;
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
      document.documentElement.classList.toggle('light', saved === 'light');
      document.documentElement.classList.toggle('dark', saved === 'dark');
    }
  }, []);

  // Tab prefs: load persisted personalization on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-tab-prefs');
      if (raw) {
        const p = JSON.parse(raw);
        setTabPrefs({ hidden: p.hidden ?? [], pinned: p.pinned ?? [], order: p.order ?? [] });
      }
    } catch { /* ignore */ }
  }, []);

  const updateTabPrefs = useCallback((updater: (prev: { hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] }) => { hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] }) => {
    setTabPrefs((prev) => {
      const next = updater(prev);
      try { localStorage.setItem('jarvis-tab-prefs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('light', next === 'light');
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem('jarvis-theme', next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Live clock — only after mount to avoid hydration mismatch.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const openPalette = useCallback(() => {
    setPaletteKey((k) => k + 1);
    setPaletteOpen(true);
  }, []);

  // Command palette shortcut (Cmd/Ctrl+K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => {
          if (!o) setPaletteKey((k) => k + 1);
          return !o;
        });
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setGlobalSearchOpen((o) => !o);
      }
      // `?` (Shift+/) toggles the shortcuts overlay — but only when not typing in an input.
      if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
      // `T` toggles theme (only when not typing + no modifiers).
      if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        toggleTheme();
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setGlobalSearchOpen(false);
        setNotifOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTheme]);

  // Orion mode: default shell on app open. On first visit (no localStorage
  // key), Orion opens automatically. After that, the user's last choice
  // (open/closed) is persisted and restored.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-orion-mode');
      if (raw === null) {
        // First visit — default to Orion open (hands-free voice shell).
        setOrionMode(true);
        localStorage.setItem('jarvis-orion-mode', '1');
      } else if (raw === '1') {
        setOrionMode(true);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('jarvis-orion-mode', orionMode ? '1' : '0'); } catch { /* ignore */ }
  }, [orionMode]);

  // Orion mode shortcut (Cmd/Ctrl+Shift+O).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setOrionMode((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigate = useCallback((t: TabKey) => {
    navigateStore(t);
    setSidebarOpen(false);
    setPaletteOpen(false);
  }, [navigateStore]);

  const ActiveTab = TAB_MAP[tab];

  // Ordered sidebar groups: Pinned (dynamic) first, then SIDEBAR_GROUPS in the
  // declared order. Tabs whose group isn't in SIDEBAR_GROUPS fall back to a
  // catch-all "Other" bucket at the end (defensive — shouldn't happen).
  const grouped = useMemo(() => {
    const visibleTabs = TABS.filter((t) => !tabPrefs.hidden.includes(t.key));
    const pinnedTabs = visibleTabs.filter((t) => tabPrefs.pinned.includes(t.key));
    const unpinnedTabs = visibleTabs.filter((t) => !tabPrefs.pinned.includes(t.key));
    const g: Record<string, TabDef[]> = {};
    if (pinnedTabs.length) g['Pinned'] = pinnedTabs;
    for (const t of unpinnedTabs) (g[t.group] ??= []).push(t);
    return g;
  }, [tabPrefs.hidden, tabPrefs.pinned]);

  // Ordered list of [groupKey, tabs[]] for rendering, respecting SIDEBAR_GROUPS.
  const orderedGroups = useMemo(() => {
    const out: { key: string; label: string; accent: string; tabs: TabDef[] }[] = [];
    if (grouped['Pinned']?.length) {
      out.push({ key: 'Pinned', label: 'Pinned', accent: JARVIS.colors.amber, tabs: grouped['Pinned'] });
    }
    for (const sg of SIDEBAR_GROUPS) {
      const tabs = grouped[sg.key];
      if (tabs?.length) out.push({ key: sg.key, label: sg.label, accent: sg.accent, tabs });
    }
    // Catch-all for any tab whose group isn't in SIDEBAR_GROUPS (defensive).
    const known = new Set(['Pinned', ...SIDEBAR_GROUPS.map((s) => s.key)]);
    for (const [k, tabs] of Object.entries(grouped)) {
      if (!known.has(k) && tabs.length) out.push({ key: k, label: k, accent: JARVIS.colors.cyan, tabs });
    }
    return out;
  }, [grouped]);

  const cur = TABS.find((t) => t.key === tab)!;

  return (
    <div className="min-h-screen flex flex-col relative">
      <div className="jarvis-bg" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--j-border)] bg-[rgba(7,8,10,0.82)] backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="flex h-8 w-8 items-center justify-center rounded-md jarvis-btn-accent">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <CircleDot className="absolute -top-1 -right-1 h-2.5 w-2.5 text-[var(--j-green)] jarvis-blink" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-bold tracking-tight jarvis-text-gradient">{appName}</div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">Mission Control v{appVersion}</div>
            </div>
          </div>

          {/* Mini metrics */}
          <div className="hidden md:flex items-center gap-3 ml-4">
            <MiniMetric icon={Cpu} label="CPU" value={metrics ? `${Math.round(metrics.current.cpu)}%` : '—'} color={JARVIS.colors.cyan} />
            <MiniMetric icon={MemoryStick} label="MEM" value={metrics ? `${Math.round(metrics.current.mem)}%` : '—'} color={JARVIS.colors.violet} />
            <MiniMetric icon={Zap} label="LAT" value={metrics ? `${metrics.current.latency}ms` : '—'} color={JARVIS.colors.amber} />
            <MiniMetric icon={Radio} label="TOK" value={metrics ? metrics.current.tokens.toLocaleString() : '—'} color={JARVIS.colors.green} />
          </div>

          <div className="flex-1" />

          {/* Live clock */}
          <div className="hidden sm:flex flex-col items-end leading-none mr-1">
            <div className="jarvis-mono text-sm text-[var(--j-cyan)] tabular-nums">{now ? fmtTime(now) : '--:--:--'}</div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">local · IST</div>
          </div>

          <button
            onClick={openPalette}
            className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="jarvis-mono text-[10px] uppercase hidden sm:inline">Search</span>
            <kbd className="jarvis-mono text-[9px] px-1 py-0.5 rounded border border-[var(--j-border)] bg-[var(--j-bg)] hidden sm:inline">⌘K</kbd>
          </button>

          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>

          <button
            onClick={() => setShortcutsOpen((o) => !o)}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </button>

          <NotificationsBell open={notifOpen} setOpen={setNotifOpen} />
        </div>
        <div className="h-px jarvis-hr" />
        {/* Live activity ticker — scrolling marquee of recent events */}
        <ActivityTicker />
      </header>

      <div className="flex flex-1 relative z-10">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              className="fixed inset-0 bg-black/60 z-30 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        <aside
          className={cn(
            'fixed lg:sticky top-14 z-30 lg:z-auto h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-[var(--j-border)] bg-[rgba(10,13,18,0.92)] backdrop-blur-xl overflow-y-auto jarvis-scroll transition-transform',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          <nav className="p-3 space-y-5">
            {orderedGroups.map((grp) => (
              <div key={grp.key}>
                <div
                  className="jarvis-mono text-[9px] uppercase px-2 mb-1.5 tracking-widest flex items-center gap-1.5"
                  style={{ color: grp.accent }}
                >
                  <span className="h-1 w-1 rounded-full" style={{ background: grp.accent }} />
                  {grp.label}
                </div>
                <div className="space-y-0.5">
                  {grp.tabs.map((t) => {
                    const active = tab === t.key;
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.key}
                        onClick={() => navigate(t.key)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all group relative',
                          active ? 'bg-[var(--j-panel-soft)] text-[var(--j-text)]' : 'text-[var(--j-text-dim)] hover:text-[var(--j-text)] hover:bg-[var(--j-panel-soft)]/60',
                        )}
                      >
                        {active && (
                          <motion.div
                            layoutId="tab-active"
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full"
                            style={{ background: t.accent, boxShadow: `0 0 8px ${t.accent}` }}
                          />
                        )}
                        <Icon className="h-4 w-4 shrink-0" style={{ color: active ? t.accent : undefined }} />
                        <span className="flex-1 text-left">{tabLabelOf(t)}</span>
                        {t.key === 'comms' && commsUnread > 0 && (
                          <span className="h-4 min-w-4 px-1 rounded-full bg-[var(--j-violet)] text-[9px] font-bold text-white flex items-center justify-center jarvis-mono">{commsUnread}</span>
                        )}
                        {active && <ChevronRight className="h-3.5 w-3.5" style={{ color: t.accent }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-3 mt-auto">
            <button
              onClick={() => setManageOpen(true)}
              className="w-full flex items-center justify-center gap-2 h-8 mb-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span className="jarvis-mono text-[10px] uppercase">Manage Tabs</span>
            </button>
            <div className="jarvis-panel p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-green)] jarvis-pulse-dot" style={{ color: JARVIS.colors.green }} />
                <span className="jarvis-mono text-[9px] uppercase text-[var(--j-green)]">All Systems Operational</span>
              </div>
              <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{appPoweredBy}</div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 relative">
          {/* Tab header strip */}
          <div className="sticky top-14 z-20 border-b border-[var(--j-border)] bg-[rgba(7,8,10,0.7)] backdrop-blur-md px-4 lg:px-6 h-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <cur.icon className="h-3.5 w-3.5" style={{ color: cur.accent }} />
              <span className="jarvis-mono text-[11px] uppercase tracking-widest jarvis-tab-glow" style={{ color: cur.accent }}>{tabLabelOf(cur)}</span>
            </div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hidden sm:flex items-center gap-1.5">
              <Command className="h-3 w-3" /> press <kbd className="px-1 py-0.5 rounded border border-[var(--j-border)] bg-[var(--j-bg)]">⌘K</kbd> for palette
            </div>
          </div>

          <div className="p-4 lg:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <ActiveTab />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--j-border)] bg-[rgba(7,8,10,0.82)] backdrop-blur-xl relative z-10">
        <div className="px-4 lg:px-6 h-9 flex items-center justify-between jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-green)] jarvis-blink" />
              <span className="text-[var(--j-green)]">ONLINE</span>
            </span>
            <span className="hidden sm:inline">8 agents · 20 skills · 25 modules</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline">uptime {metrics ? formatUptime(metrics.current.uptime) : '—'}</span>
            <span>{appName} v{appVersion} · {appCompany}</span>
            {appPoweredBy && <span className="hidden lg:inline text-[var(--j-text-mute)]">· {appPoweredBy}</span>}
          </div>
        </div>
      </footer>

      {/* Command palette — keyed so it remounts fresh (reset query) each time it opens */}
      <CommandPalette
        key={paletteKey}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        pinned={tabPrefs.pinned}
        onTogglePin={(key) => updateTabPrefs((prev) => ({
          ...prev,
          pinned: prev.pinned.includes(key)
            ? prev.pinned.filter((k) => k !== key)
            : [...prev.pinned, key],
        }))}
        hidden={tabPrefs.hidden}
        onToggleHide={(key) => updateTabPrefs((prev) => ({
          ...prev,
          hidden: prev.hidden.includes(key)
            ? prev.hidden.filter((k) => k !== key)
            : [...prev.hidden, key],
        }))}
      />

      {/* Global search overlay (Cmd+Shift+F) */}
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} onNavigate={navigate} />

      {/* Manage tabs modal */}
      <AnimatePresence>
        {manageOpen && (
          <ManageTabsModal
            onClose={() => setManageOpen(false)}
            tabPrefs={tabPrefs}
            updateTabPrefs={updateTabPrefs}
            onNavigate={(t) => { navigate(t); setManageOpen(false); }}
          />
        )}
      </AnimatePresence>

      {/* Keyboard shortcuts overlay (press `?`) */}
      <AnimatePresence>
        {shortcutsOpen && (
          <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} onNavigate={(t) => { navigate(t); setShortcutsOpen(false); }} />
        )}
      </AnimatePresence>

      {/* Floating Orion mode toggle (bottom-right) */}
      <motion.button
        onClick={() => setOrionMode((o) => !o)}
        initial={false}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 h-11 pl-3 pr-4 rounded-full border shadow-lg transition-colors group"
        style={{
          background: orionMode ? `${JARVIS.colors.green}1a` : 'rgba(10,13,18,0.85)',
          borderColor: orionMode ? JARVIS.colors.green : JARVIS.colors.cyan,
          boxShadow: `0 0 20px ${orionMode ? JARVIS.colors.green : JARVIS.colors.cyan}40`,
          backdropFilter: 'blur(8px)',
        }}
        aria-label={orionMode ? 'Exit Orion mode' : 'Enter Orion voice mode'}
        title={orionMode ? 'Exit Orion mode (Ctrl+Shift+O)' : 'Orion voice mode (Ctrl+Shift+O)'}
      >
        <motion.span
          animate={{ scale: orionMode ? [1, 1.25, 1] : 1 }}
          transition={{ duration: 1.2, repeat: orionMode ? Infinity : 0, ease: 'easeInOut' }}
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: orionMode ? `${JARVIS.colors.green}33` : `${JARVIS.colors.cyan}33`,
            border: `1px solid ${orionMode ? JARVIS.colors.green : JARVIS.colors.cyan}`,
            color: orionMode ? JARVIS.colors.green : JARVIS.colors.cyan,
          }}
        >
          <Radio className="h-3.5 w-3.5" />
        </motion.span>
        <span
          className="jarvis-mono text-[10px] uppercase tracking-wider"
          style={{ color: orionMode ? JARVIS.colors.green : JARVIS.colors.cyan }}
        >
          {orionMode ? 'Full UI' : 'Orion'}
        </span>
      </motion.button>

      {/* Orion Shell — full-screen voice-first overlay */}
      <AnimatePresence>
        {orionMode && <OrionShell onClose={() => setOrionMode(false)} />}
      </AnimatePresence>
    </div>
  );
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function MiniMetric({ icon: Icon, label, value, color }: { icon: typeof Cpu; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3" style={{ color }} />
      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</span>
      <span className="jarvis-mono text-[11px] tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

/**
 * Live activity ticker — a thin scrolling marquee below the header that shows
 * the most recent fleet events (agent status changes, task completions, comms,
 * errors). Polls /api/activity every 10s. Clicking an item navigates to the
 * relevant tab.
 */
function ActivityTicker() {
  const { data } = useApi<{ events: Array<{ id: string; type: string; level: string; title: string; detail?: string; time: string }> }>(
    '/api/activity?limit=15',
    10000,
  );
  const navigate = useNavStore((s) => s.navigate);
  const events = data?.events ?? [];

  if (events.length === 0) return null;

  // Duplicate the events for seamless infinite scroll
  const items = [...events, ...events];

  return (
    <div className="h-7 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-2 bg-[var(--j-panel-soft)] border-r border-[var(--j-border)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-green)] jarvis-blink mr-1.5" />
        <span className="jarvis-mono text-[9px] uppercase text-[var(--j-green)] tracking-widest">LIVE</span>
      </div>
      <div className="flex items-center h-full pl-20 overflow-hidden">
        <motion.div
          className="flex items-center gap-6 shrink-0 whitespace-nowrap"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: Math.max(20, events.length * 3), repeat: Infinity, ease: 'linear' }}
        >
          {items.map((item, i) => {
            const color = activityColor(item.level || item.type);
            const Icon = activityIcon(item.type);
            return (
              <button
                key={`${item.id}-${i}`}
                onClick={() => navigate(activityTab(item.type))}
                className="flex items-center gap-1.5 text-[10px] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] transition-colors group"
              >
                <Icon className="h-3 w-3 shrink-0" style={{ color }} />
                <span className="jarvis-mono text-[9px] uppercase shrink-0" style={{ color }}>{item.type}</span>
                <span className="truncate max-w-[200px] group-hover:text-[var(--j-text)]">{item.title}</span>
                {item.time && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">· {item.time}</span>}
              </button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}

function activityColor(typeOrLevel: string): string {
  switch (typeOrLevel) {
    case 'error': return JARVIS.colors.red;
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'warning': return JARVIS.colors.amber;
    case 'comms': return JARVIS.colors.violet;
    case 'task': return JARVIS.colors.amber;
    case 'agent': return JARVIS.colors.cyan;
    case 'spawn': return JARVIS.colors.green;
    case 'skill': return JARVIS.colors.cyan;
    case 'notification': return JARVIS.colors.cyan;
    case 'info': return JARVIS.colors.cyan;
    default: return JARVIS.colors.cyan;
  }
}

function activityIcon(type: string): typeof Activity {
  switch (type) {
    case 'error': return AlertCircle;
    case 'success': return CheckCircle;
    case 'warn': return AlertTriangle;
    case 'warning': return AlertTriangle;
    case 'comms': return MessageSquare;
    case 'task': return ListTodo;
    case 'agent': return Bot;
    case 'spawn': return Copy;
    case 'skill': return Sparkles;
    case 'notification': return Bell;
    case 'info': return Activity;
    default: return Activity;
  }
}

function activityTab(type: string): string {
  switch (type) {
    case 'error': return 'monitoring';
    case 'comms': return 'comms';
    case 'task': return 'tasks';
    case 'agent': return 'fleet';
    case 'spawn': return 'fleet';
    case 'skill': return 'skills';
    case 'notification': return 'activity';
    case 'info': return 'activity';
    default: return 'activity';
  }
}

function NotificationsBell({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const { data, refresh } = useApi<{ notifications: Array<{ id: string; type: string; title: string; message: string; read: boolean; createdAt: string }>; unread: number }>('/api/notifications?limit=30', 10000);
  const { data: findingsData } = useApi<{ findings: Array<{ id: string; severity: string; monitorKey: string; tab: string; title: string; detail: string; actionTab?: string; actionMeta?: string; status: string; createdAt: string }> }>(
    '/api/agent-monitors/findings?severity=critical&status=open&limit=5',
    15000,
  );
  const { toast } = useToast();
  const navigate = useNavStore((s) => s.navigate);
  const [filter, setFilter] = useState<string>('all');
  const unread = data?.unread ?? 0;
  const criticalFindings = findingsData?.findings ?? [];

  const allNotifications = data?.notifications ?? [];

  const markAll = async () => {
    if (!allNotifications.length) return;
    await Promise.all(visibleNotifications.filter((n) => !n.read).map((n) => patchNotif(n.id, true)));
    refresh();
    toast({ title: 'All notifications marked as read' });
  };

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<{ sound: boolean; desktop: boolean; mutedTypes: string[] }>({ sound: false, desktop: false, mutedTypes: [] });

  // Load settings from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-notif-settings');
      if (raw) setSettings(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const updateSettings = (updater: (prev: typeof settings) => typeof settings) => {
    setSettings((prev) => {
      const next = updater(prev);
      try { localStorage.setItem('jarvis-notif-settings', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const toggleMuteType = (type: string) => {
    updateSettings((prev) => ({
      ...prev,
      mutedTypes: prev.mutedTypes.includes(type)
        ? prev.mutedTypes.filter((t) => t !== type)
        : [...prev.mutedTypes, type],
    }));
  };

  // Filter out muted types from displayed notifications.
  const visibleNotifications = allNotifications.filter((n) => !settings.mutedTypes.includes(n.type));
  const visibleTypeCounts = visibleNotifications.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const filteredVisible = filter === 'all' ? visibleNotifications : visibleNotifications.filter((n) => n.type === filter);
  const visibleUnread = visibleNotifications.filter((n) => !n.read).length;
  const visibleTotalBadge = visibleUnread + criticalFindings.length;

  const markOne = async (id: string, read: boolean) => {
    await patchNotif(id, read);
    refresh();
  };

  // Track previous unread count + seen notification IDs to detect new arrivals.
  const prevUnreadRef = useRef(0);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  // Debounce timer for batching desktop notifications.
  const desktopBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopBatchQueueRef = useRef<Array<{ title: string; message: string; type: string; id: string }>>([]);

  useEffect(() => {
    const currentUnread = visibleUnread;
    const prevUnread = prevUnreadRef.current;
    // Detect new unread notifications by comparing IDs.
    const currentUnreadNotifs = visibleNotifications.filter((n) => !n.read);
    const newNotifs = currentUnreadNotifs.filter((n) => !seenNotifIdsRef.current.has(n.id));

    // Update seen set with all current unread IDs.
    seenNotifIdsRef.current = new Set(currentUnreadNotifs.map((n) => n.id));

    if (newNotifs.length === 0 || prevUnread === 0) {
      prevUnreadRef.current = currentUnread;
      return;
    }

    // Find the newest notification for the sound alert (play once, not per-notification).
    const newest = newNotifs[0];
    if (newest) {
      // Sound alert: play a short beep using Web Audio API (no asset needed).
      if (settings.sound && !settings.mutedTypes.includes(newest.type)) {
        try {
          const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = newest.type === 'error' ? 220 : newest.type === 'warn' ? 440 : 660;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        } catch { /* AudioContext not available */ }
      }
    }

    // Desktop notification with batching: queue new notifications and show a
    // single grouped notification after a 2s debounce (instead of one per
    // notification — prevents notification spam when many arrive at once).
    if (settings.desktop && 'Notification' in window && Notification.permission === 'granted') {
      const visibleNew = newNotifs.filter((n) => !settings.mutedTypes.includes(n.type));
      if (visibleNew.length > 0) {
        desktopBatchQueueRef.current.push(...visibleNew.map((n) => ({ title: n.title, message: n.message, type: n.type, id: n.id })));
        // Clear any existing timer and set a new one (debounce).
        if (desktopBatchTimerRef.current) clearTimeout(desktopBatchTimerRef.current);
        desktopBatchTimerRef.current = setTimeout(() => {
          const batch = desktopBatchQueueRef.current;
          desktopBatchQueueRef.current = [];
          if (batch.length === 0) return;
          try {
            if (batch.length === 1) {
              // Single notification — show as-is. Click → focus + navigate.
              const notif = new Notification(batch[0].title, {
                body: batch[0].message.slice(0, 200),
                icon: '/favicon.ico',
                tag: batch[0].id,
              });
              // Click-to-navigate: map notification type → target tab.
              //   error → logs, success → activity, warn → agent-monitor,
              //   info/default → activity.
              const targetTab = batch[0].type === 'error'
                ? 'logs'
                : batch[0].type === 'success'
                  ? 'activity'
                  : batch[0].type === 'warn'
                    ? 'agent-monitor'
                    : 'activity';
              notif.onclick = () => {
                window.focus();
                navigate(targetTab);
                notif.close();
              };
            } else {
              // Multiple notifications — group into one.
              const hasErrors = batch.some((n) => n.type === 'error');
              const title = hasErrors ? `${batch.length} notifications (${batch.filter((n) => n.type === 'error').length} errors)` : `${batch.length} new notifications`;
              const body = batch.slice(0, 4).map((n) => `• ${n.title}`).join('\n') + (batch.length > 4 ? `\n• +${batch.length - 4} more` : '');
              const notif = new Notification(title, {
                body,
                icon: '/favicon.ico',
                tag: 'jarvis-batch-' + Date.now(),
              });
              // Grouped click → focus window + navigate to activity tab.
              notif.onclick = () => {
                window.focus();
                navigate('activity');
                notif.close();
              };
            }
          } catch { /* Notification API not available */ }
        }, 2000);
      }
    }

    prevUnreadRef.current = currentUnread;
  }, [visibleUnread, visibleNotifications, settings.sound, settings.desktop, settings.mutedTypes, navigate]);

  // Request Notification permission when desktop setting is toggled on.
  useEffect(() => {
    if (settings.desktop && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [settings.desktop]);

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {visibleTotalBadge > 0 && (
          <span className={cn(
            'absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center',
            criticalFindings.length > 0 ? 'bg-[var(--j-red)] jarvis-pulse-dot' : 'bg-[var(--j-amber)]'
          )}>
            {visibleTotalBadge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute right-0 mt-2 w-96 z-50 jarvis-panel p-0 overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--j-border)]">
                <div className="flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 text-[var(--j-cyan)]" />
                  <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Notifications</span>
                  {visibleTotalBadge > 0 && <span className="jarvis-mono text-[9px] px-1.5 rounded bg-[var(--j-amber)]/20 text-[var(--j-amber)]">{visibleUnread} unread</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowSettings((s) => !s)}
                    className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${showSettings ? 'text-[var(--j-cyan)] bg-[var(--j-cyan)]/10' : 'text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]'}`}
                    title="Notification settings"
                  >
                    <Sliders className="h-3 w-3" />
                  </button>
                  <button onClick={markAll} disabled={visibleUnread === 0} className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline disabled:opacity-40 disabled:no-underline">
                    Mark all read
                  </button>
                </div>
              </div>

              {/* Settings panel (toggle) */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/40"
                  >
                    <div className="p-3 space-y-3">
                      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] tracking-widest">Notification Settings</div>
                      {/* Sound + Desktop toggles */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => updateSettings((p) => ({ ...p, sound: !p.sound }))}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs transition-colors ${settings.sound ? 'border-[var(--j-green)] bg-[var(--j-green)]/10 text-[var(--j-green)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)]'}`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: settings.sound ? JARVIS.colors.green : 'var(--j-text-mute)' }} />
                          Sound alerts
                        </button>
                        <button
                          onClick={() => updateSettings((p) => ({ ...p, desktop: !p.desktop }))}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs transition-colors ${settings.desktop ? 'border-[var(--j-green)] bg-[var(--j-green)]/10 text-[var(--j-green)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)]'}`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: settings.desktop ? JARVIS.colors.green : 'var(--j-text-mute)' }} />
                          Desktop notifications
                        </button>
                      </div>
                      {/* Per-type mute toggles */}
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">Mute by type</div>
                        <div className="flex flex-wrap gap-1.5">
                          {['success', 'warn', 'error', 'info'].map((t) => {
                            const isMuted = settings.mutedTypes.includes(t);
                            const color = notifColor(t);
                            return (
                              <button
                                key={t}
                                onClick={() => toggleMuteType(t)}
                                className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded border flex items-center gap-1.5 transition-all ${isMuted ? 'opacity-40 line-through' : ''}`}
                                style={{ borderColor: `${color}40`, color }}
                              >
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                                {t}
                                {isMuted && <span className="text-[var(--j-text-mute)]">· muted</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Filter chips */}
              {allNotifications.length > 0 && (
                <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-[var(--j-border-soft)]">
                  <button
                    onClick={() => setFilter('all')}
                    className={`jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
                      filter === 'all' ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
                    }`}
                  >
                    All ({allNotifications.length})
                  </button>
                  {Object.entries(visibleTypeCounts).map(([t, count]) => (
                    <button
                      key={t}
                      onClick={() => setFilter(filter === t ? 'all' : t)}
                      className={`jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
                        filter === t ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
                      }`}
                    >
                      {t} ({count})
                    </button>
                  ))}
                </div>
              )}

              <div className="max-h-96 overflow-y-auto jarvis-scroll">
                {/* Critical agent-monitor findings first */}
                {criticalFindings.length > 0 && filter === 'all' && (
                  <div className="border-b border-[var(--j-red)]/30">
                    <div className="px-3 py-1.5 bg-[var(--j-red)]/10 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-red)] jarvis-pulse-dot" />
                      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-red)] tracking-widest">Agent Alerts · {criticalFindings.length}</span>
                    </div>
                    {criticalFindings.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          navigate(f.actionTab || 'monitoring', f.actionMeta ? JSON.parse(f.actionMeta) : { findingId: f.id });
                          setOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-red)]/10 transition-colors block"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="jarvis-mono text-[9px] uppercase px-1 rounded bg-[var(--j-red)]/20 text-[var(--j-red)]">{f.monitorKey}</span>
                          <span className="text-xs font-medium text-[var(--j-text)] truncate flex-1">{f.title}</span>
                          <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{formatTime(f.createdAt)}</span>
                        </div>
                        <div className="text-[11px] text-[var(--j-text-dim)] line-clamp-2">{f.detail}</div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] mt-1">→ {f.actionTab || 'monitoring'} tab</div>
                      </button>
                    ))}
                  </div>
                )}
                {/* Regular notifications */}
                {filteredVisible.length > 0 ? (
                  filteredVisible.map((n) => (
                    <div
                      key={n.id}
                      className={cn('group px-3 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/60 transition-colors', !n.read && 'bg-[var(--j-cyan)]/5')}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: notifColor(n.type) }} />
                        <span className="text-xs font-medium text-[var(--j-text)] flex-1 truncate">{n.title}</span>
                        <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{formatTime(n.createdAt)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--j-text-dim)] line-clamp-2">{n.message}</div>
                      {/* Per-notification mark-as-read button */}
                      <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.read && (
                          <button
                            onClick={() => markOne(n.id, true)}
                            className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline"
                          >
                            Mark read
                          </button>
                        )}
                        {n.read && (
                          <button
                            onClick={() => markOne(n.id, false)}
                            className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
                          >
                            Mark unread
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : criticalFindings.length === 0 ? (
                  <div className="px-3 py-10 text-center">
                    <Bell className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-30" />
                    <div className="text-xs text-[var(--j-text-mute)]">No notifications</div>
                    {filter !== 'all' && <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1">Try a different filter</div>}
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="px-3 py-1.5 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                <span>{filteredVisible.length} shown{filter !== 'all' ? ` · filtered by ${filter}` : ''}</span>
                <button onClick={() => navigate('activity')} className="text-[var(--j-cyan)] hover:underline">View all activity →</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function notifColor(type: string): string {
  switch (type) {
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'error': return JARVIS.colors.red;
    default: return JARVIS.colors.cyan;
  }
}

async function patchNotif(id: string, read: boolean) {
  await fetch(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read }) });
}

/* ---------- Command palette ---------- */
function CommandPalette({ open, onClose, onNavigate, pinned = [], onTogglePin, hidden = [], onToggleHide }: {
  open: boolean;
  onClose: () => void;
  onNavigate: (t: TabKey) => void;
  pinned?: TabKey[];
  onTogglePin?: (key: TabKey) => void;
  hidden?: TabKey[];
  onToggleHide?: (key: TabKey) => void;
}) {
  // Fresh mount (via key in parent) ensures q/sel start empty each open.
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recentTabs, setRecentTabs] = useState<TabKey[]>([]);
  const [frequentTabs, setFrequentTabs] = useState<Array<{ key: TabKey; count: number }>>([]);

  // Load recent + frequent tabs from localStorage on mount.
  useEffect(() => {
    try {
      const rawRecent = localStorage.getItem('jarvis-recent-tabs');
      if (rawRecent) setRecentTabs(JSON.parse(rawRecent).slice(0, 5));
      const rawFreq = localStorage.getItem('jarvis-frequent-tabs');
      if (rawFreq) setFrequentTabs(JSON.parse(rawFreq).slice(0, 5));
    } catch { /* ignore */ }
  }, []);

  // Track navigation when a tab is selected from the palette.
  const navigateAndTrack = useCallback((key: TabKey) => {
    // Update recent tabs (most recent first, deduped, max 5).
    setRecentTabs((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, 5);
      try { localStorage.setItem('jarvis-recent-tabs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    // Update frequent tabs (sorted by count, max 5).
    setFrequentTabs((prev) => {
      const existing = prev.find((t) => t.key === key);
      const updated = existing
        ? prev.map((t) => (t.key === key ? { ...t, count: t.count + 1 } : t))
        : [...prev, { key, count: 1 }];
      updated.sort((a, b) => b.count - a.count);
      const top = updated.slice(0, 5);
      try { localStorage.setItem('jarvis-frequent-tabs', JSON.stringify(top)); } catch { /* ignore */ }
      return top;
    });
    onNavigate(key);
  }, [onNavigate]);

  const [showHidden, setShowHidden] = useState(false);

  const results = useMemo(() => {
    const ql = q.toLowerCase();
    return TABS.filter((t) => !ql || t.label.toLowerCase().includes(ql) || t.group.toLowerCase().includes(ql));
  }, [q]);

  // Build the display list: when no query, show recent + frequent + all. When query, show filtered.
  const displaySections = useMemo(() => {
    if (q.trim()) {
      return [{ label: 'Results', items: results }];
    }
    const sections: Array<{ label: string; items: TabDef[] }> = [];
    if (recentTabs.length > 0) {
      const items = recentTabs
        .map((k) => TABS.find((t) => t.key === k))
        .filter((t): t is TabDef => Boolean(t));
      if (items.length > 0) sections.push({ label: 'Recent', items });
    }
    if (frequentTabs.length > 0) {
      const items = frequentTabs
        .map((f) => TABS.find((t) => t.key === f.key))
        .filter((t): t is TabDef => Boolean(t));
      if (items.length > 0) sections.push({ label: 'Frequent', items });
    }
    // All visible tabs (exclude hidden unless showHidden is on)
    const visibleTabs = TABS.filter((t) => showHidden || !hidden.includes(t.key));
    sections.push({ label: 'All Tabs', items: visibleTabs });
    // Hidden tabs section (only when showHidden is on and there are hidden tabs)
    if (showHidden && hidden.length > 0) {
      const hiddenItems = hidden.map((k) => TABS.find((t) => t.key === k)).filter((t): t is TabDef => Boolean(t));
      if (hiddenItems.length > 0) sections.push({ label: 'Hidden', items: hiddenItems });
    }
    return sections;
  }, [q, results, recentTabs, frequentTabs, hidden, showHidden]);

  // Flatten for keyboard nav.
  const flatItems = displaySections.flatMap((s) => s.items);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flatItems.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); const r = flatItems[sel]; if (r) navigateAndTrack(r.key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flatItems, sel, navigateAndTrack]);

  // Reset selection when query changes.
  useEffect(() => { setSel(0); }, [q]);

  let runningIdx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-xl jarvis-panel p-0 overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[var(--j-border)]">
              <Search className="h-4 w-4 text-[var(--j-text-mute)]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => { setQ(e.target.value); setSel(0); }}
                placeholder="Search tabs and actions…"
                className="flex-1 bg-transparent outline-none text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
              />
              <kbd className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-text-mute)]">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto jarvis-scroll p-2">
              {flatItems.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-[var(--j-text-mute)]">No results for "{q}"</div>
              ) : (
                displaySections.map((section) => {
                  if (section.items.length === 0) return null;
                  return (
                    <div key={section.label} className="mb-2">
                      <div className="jarvis-mono text-[9px] uppercase tracking-widest text-[var(--j-text-mute)] px-3 py-1.5 flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-[var(--j-text-mute)]" />
                        {section.label}
                        <span className="ml-1 text-[var(--j-text-mute)] opacity-60">({section.items.length})</span>
                      </div>
                      {section.items.map((t) => {
                        runningIdx++;
                        const i = runningIdx;
                        const Icon = t.icon;
                        const active = i === sel;
                        const isPinned = pinned.includes(t.key);
                        return (
                          <div
                            key={`${section.label}-${t.key}`}
                            onMouseEnter={() => setSel(i)}
                            className={cn('group w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer', active ? 'bg-[var(--j-panel-soft)] text-[var(--j-text)]' : 'text-[var(--j-text-dim)] hover:bg-[var(--j-panel-soft)]/40')}
                            onClick={() => navigateAndTrack(t.key)}
                          >
                            <Icon className="h-4 w-4 shrink-0" style={{ color: active ? t.accent : undefined }} />
                            <span className="flex-1 text-left truncate">{t.label}</span>
                            {section.label === 'Frequent' && (
                              <span className="jarvis-mono text-[9px] text-[var(--j-amber)]">
                                {frequentTabs.find((f) => f.key === t.key)?.count}×
                              </span>
                            )}
                            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{t.group}</span>
                            {/* Pin/unpin button — quick-pin from palette */}
                            {onTogglePin && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onTogglePin(t.key); }}
                                className={`shrink-0 h-5 w-5 flex items-center justify-center rounded transition-all ${
                                  isPinned
                                    ? 'text-[var(--j-amber)] opacity-100'
                                    : 'text-[var(--j-text-mute)] opacity-0 group-hover:opacity-100 hover:text-[var(--j-amber)]'
                                }`}
                                title={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                              >
                                <Pin className={cn('h-3 w-3', isPinned && 'fill-current')} />
                              </button>
                            )}
                            {/* Hide/unhide button — quick-hide from palette */}
                            {onToggleHide && section.label !== 'Hidden' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleHide(t.key); }}
                                className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-[var(--j-text-mute)] opacity-0 group-hover:opacity-100 hover:text-[var(--j-red)] transition-all"
                                title="Hide from sidebar"
                              >
                                <EyeOff className="h-3 w-3" />
                              </button>
                            )}
                            {/* Unhide button — only in Hidden section */}
                            {onToggleHide && section.label === 'Hidden' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleHide(t.key); }}
                                className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-[var(--j-green)] opacity-0 group-hover:opacity-100 hover:text-[var(--j-green)] transition-all"
                                title="Show in sidebar"
                              >
                                <Eye className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
            <div className="px-4 py-2 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              <span className="flex items-center gap-3">
                <span>{flatItems.length} items</span>
                {hidden.length > 0 && (
                  <button
                    onClick={() => setShowHidden((s) => !s)}
                    className={`flex items-center gap-1 hover:text-[var(--j-cyan)] transition-colors ${showHidden ? 'text-[var(--j-cyan)]' : ''}`}
                  >
                    {showHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {hidden.length} hidden
                  </button>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span>↑↓ navigate</span>
                <span>⏎ open</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Manage Tabs modal (personalization) ---------- */
function ManageTabsModal({
  onClose,
  tabPrefs,
  updateTabPrefs,
  onNavigate,
}: {
  onClose: () => void;
  tabPrefs: { hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] };
  updateTabPrefs: (updater: (prev: { hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] }) => { hidden: TabKey[]; pinned: TabKey[]; order: TabKey[] }) => void;
  onNavigate: (t: TabKey) => void;
}) {
  const toggleHidden = (key: TabKey) => {
    updateTabPrefs((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(key) ? prev.hidden.filter((k) => k !== key) : [...prev.hidden, key],
    }));
  };
  const togglePinned = (key: TabKey) => {
    updateTabPrefs((prev) => ({
      ...prev,
      pinned: prev.pinned.includes(key) ? prev.pinned.filter((k) => k !== key) : [...prev.pinned, key],
    }));
  };
  const resetAll = () => {
    updateTabPrefs(() => ({ hidden: [], pinned: [], order: [] }));
  };
  const visibleCount = TABS.length - tabPrefs.hidden.length;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-2xl jarvis-panel p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-[var(--j-cyan)]" />
            <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">Manage Tabs</h3>
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{visibleCount} visible · {tabPrefs.pinned.length} pinned · {tabPrefs.hidden.length} hidden</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetAll} className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]">reset</button>
            <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="overflow-y-auto jarvis-scroll p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TABS.map((t) => {
              const isHidden = tabPrefs.hidden.includes(t.key);
              const isPinned = tabPrefs.pinned.includes(t.key);
              const Icon = t.icon;
              return (
                <div
                  key={t.key}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all ${isHidden ? 'border-[var(--j-border-soft)] opacity-50' : 'border-[var(--j-border)] bg-[var(--j-panel-soft)]/40'}`}
                >
                  <button
                    onClick={() => togglePinned(t.key)}
                    className={`flex h-7 w-7 items-center justify-center rounded-md shrink-0 transition-colors ${isPinned ? 'text-[var(--j-violet)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-violet)]'}`}
                    title={isPinned ? 'Unpin' : 'Pin to top'}
                  >
                    <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-[var(--j-violet)]' : ''}`} />
                  </button>
                  <div className="flex h-7 w-7 items-center justify-center rounded-md shrink-0" style={{ background: `${t.accent}1a`, border: `1px solid ${t.accent}33`, color: t.accent }}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <button onClick={() => !isHidden && onNavigate(t.key)} className="flex-1 text-left min-w-0">
                    <div className="text-xs text-[var(--j-text)] truncate">{t.label}</div>
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{isPinned ? 'pinned · ' : ''}{t.group}</div>
                  </button>
                  <button
                    onClick={() => toggleHidden(t.key)}
                    className={`flex h-7 w-7 items-center justify-center rounded-md shrink-0 transition-colors ${isHidden ? 'text-[var(--j-text-mute)] hover:text-[var(--j-green)]' : 'text-[var(--j-green)] hover:text-[var(--j-red)]'}`}
                    title={isHidden ? 'Show' : 'Hide'}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="px-5 py-2.5 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">preferences saved to this browser</span>
          <button onClick={onClose} className="jarvis-mono text-[10px] uppercase px-3 py-1 rounded jarvis-btn-accent border-0">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Global search overlay (Cmd+Shift+F) ---------- */
interface SearchResult {
  id: string;
  type: 'agent' | 'task' | 'memory' | 'comms' | 'skill';
  title: string;
  subtitle: string;
  meta: string;
  color: string;
  href: TabKey;
  score: number;
}

function GlobalSearch({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (t: TabKey) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [byType, setByType] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [savedSearches, setSavedSearches] = useState<string[]>([]);

  // Load saved searches from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-saved-searches');
      if (raw) setSavedSearches(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const saveSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setSavedSearches((prev) => {
      const next = prev.includes(t) ? prev.filter((s) => s !== t) : [...prev, t].slice(-8);
      try { localStorage.setItem('jarvis-saved-searches', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Debounced search.
  useEffect(() => {
    if (!open) { setQ(''); setResults([]); setByType({}); setSel(0); setTypeFilter('all'); return; }
    if (!q.trim()) { setResults([]); setByType({}); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${typeFilter !== 'all' ? `&type=${typeFilter}` : ''}`, { cache: 'no-store' });
        const json = await res.json();
        setResults(json.results ?? []);
        setByType(json.byType ?? {});
        setSel(0);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [q, open, typeFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) { onNavigate(r.href); onClose(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, sel, onNavigate, onClose]);

  const typeIcon: Record<string, typeof Bot> = {
    agent: Bot, task: ListTodo, memory: Database, comms: MessagesSquare, skill: Sparkles,
    model: Cpu, earning: DollarSign, rule: Gavel, payment: Wallet,
  };
  const typeLabel: Record<string, string> = {
    agent: 'Agents', task: 'Tasks', memory: 'Memory', comms: 'Comms', skill: 'Skills',
    model: 'Models', earning: 'Earnings', rule: 'Rules', payment: 'Payments',
  };
  const availableTypes = Object.keys(byType).filter((t) => byType[t] > 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ scale: 0.96, opacity: 0, y: -8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: -8 }} className="relative w-full max-w-2xl jarvis-panel p-0 overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[var(--j-border)]">
              <Search className="h-4 w-4 text-[var(--j-cyan)]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search agents, tasks, memory, comms, skills…"
                className="flex-1 bg-transparent outline-none text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
              />
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-cyan)]" />}
              {q.trim() && (
                <button onClick={() => saveSearch(q)} className="flex items-center gap-1 jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline shrink-0">
                  <Star className="h-3 w-3" /> {savedSearches.includes(q.trim()) ? 'saved' : 'save'}
                </button>
              )}
              <kbd className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-text-mute)]">ESC</kbd>
            </div>
            <div className="max-h-96 overflow-y-auto jarvis-scroll p-2">
              {/* Type filter chips */}
              {availableTypes.length > 0 && (
                <div className="flex flex-wrap gap-1 px-1 pb-2 mb-1 border-b border-[var(--j-border-soft)]">
                  <button
                    onClick={() => setTypeFilter('all')}
                    className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded border transition-colors ${
                      typeFilter === 'all' ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
                    }`}
                  >
                    All ({results.length})
                  </button>
                  {availableTypes.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
                      className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded border transition-colors ${
                        typeFilter === t ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
                      }`}
                    >
                      {typeLabel[t] ?? t} ({byType[t]})
                    </button>
                  ))}
                </div>
              )}
              {results.length > 0 ? (
                results.map((r, i) => {
                  const Icon = typeIcon[r.type] ?? Search;
                  const active = i === sel;
                  return (
                    <button
                      key={r.id}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => { onNavigate(r.href); onClose(); }}
                      className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors', active ? 'bg-[var(--j-panel-soft)]' : 'hover:bg-[var(--j-panel-soft)]/60')}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0" style={{ background: `${r.color}1a`, border: `1px solid ${r.color}33`, color: r.color }}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--j-text)] truncate">{r.title}</div>
                        <div className="text-[11px] text-[var(--j-text-dim)] truncate">{r.subtitle}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: r.color, background: `${r.color}1a` }}>{r.type}</div>
                        <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-0.5">{r.meta}</div>
                      </div>
                    </button>
                  );
                })
              ) : q.trim() ? (
                <div className="px-3 py-10 text-center">
                  <Search className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-40" />
                  <div className="text-sm text-[var(--j-text-mute)]">No results for "{q}"</div>
                </div>
              ) : savedSearches.length > 0 ? (
                <div className="px-3 py-4">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2 flex items-center gap-1.5"><Star className="h-3 w-3" /> saved searches</div>
                  <div className="flex flex-wrap gap-2">
                    {savedSearches.map((s) => (
                      <button key={s} onClick={() => setQ(s)} className="group flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors">
                        <Search className="h-3 w-3" /> {s}
                        <span onClick={(e) => { e.stopPropagation(); saveSearch(s); }} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] ml-0.5"><X className="h-2.5 w-2.5" /></span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-3 py-10 text-center">
                  <div className="text-sm text-[var(--j-text-mute)]">Type to search across the fleet</div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">agents · tasks · memory · comms · skills</div>
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              <span>{results.length} results</span>
              <span className="flex items-center gap-2">
                <span>↑↓ navigate</span>
                <span>⏎ open</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Returns true if the user is currently typing in an input/textarea/select
 * (so we don't hijack `?` and other shortcut keys while they're typing).
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

/* ---------- Keyboard shortcuts overlay (press `?`) ---------- */
const SHORTCUT_GROUPS: { label: string; accent: string; items: { keys: string[]; label: string; tab?: TabKey }[] }[] = [
  {
    label: 'Global',
    accent: JARVIS.colors.cyan,
    items: [
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['⌘', '⇧', 'F'], label: 'Global search' },
      { keys: ['⌘', '⇧', 'O'], label: 'Orion voice mode' },
      { keys: ['?'], label: 'This shortcuts overlay' },
      { keys: ['Esc'], label: 'Close any overlay' },
    ],
  },
  {
    label: 'Navigation',
    accent: JARVIS.colors.violet,
    items: [
      { keys: ['G', 'O'], label: 'Overview', tab: 'overview' },
      { keys: ['G', 'F'], label: 'Agent Fleet', tab: 'fleet' },
      { keys: ['G', 'T'], label: 'Tasks', tab: 'tasks' },
      { keys: ['G', 'C'], label: 'ARIA Chat', tab: 'chat' },
      { keys: ['G', 'H'], label: 'Fleet Health', tab: 'health' },
      { keys: ['G', 'M'], label: 'AI Models', tab: 'models' },
      { keys: ['G', 'P'], label: 'Payments', tab: 'payments' },
      { keys: ['G', 'A'], label: 'Monitoring', tab: 'monitoring' },
      { keys: ['G', 'S'], label: 'Scheduler', tab: 'scheduler' },
    ],
  },
  {
    label: 'Theme',
    accent: JARVIS.colors.amber,
    items: [
      { keys: ['T'], label: 'Toggle dark / light theme' },
    ],
  },
];

function ShortcutsOverlay({ onClose, onNavigate }: { onClose: () => void; onNavigate: (t: TabKey) => void }) {
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  // Listen for `G` + letter combos for go-to-tab navigation while overlay is open.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      const key = e.key.toUpperCase();
      if (key === 'G' && !isTypingTarget(e.target)) {
        setPendingKeys(['G']);
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => setPendingKeys([]), 1200);
        return;
      }
      if (pendingKeys[0] === 'G' && !isTypingTarget(e.target)) {
        for (const grp of SHORTCUT_GROUPS) {
          for (const item of grp.items) {
            if (item.tab && item.keys[1] === key) {
              e.preventDefault();
              onNavigate(item.tab);
              return;
            }
          }
        }
      }
      setPendingKeys([]);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timeout) clearTimeout(timeout);
    };
  }, [pendingKeys, onClose, onNavigate]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        className="relative w-full max-w-2xl jarvis-glass border border-[var(--j-border)] rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--j-cyan)]/15 border border-[var(--j-cyan)]/30">
              <Command className="h-4 w-4 text-[var(--j-cyan)]" />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--j-text)]">Keyboard Shortcuts</div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                {pendingKeys.length > 0 ? (
                  <span className="text-[var(--j-amber)]">listening: {pendingKeys.join(' + ')}…</span>
                ) : (
                  <span>type `G` then a letter to jump to a tab</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto jarvis-scroll grid grid-cols-1 md:grid-cols-3 gap-4">
          {SHORTCUT_GROUPS.map((grp) => (
            <div key={grp.label}>
              <div className="jarvis-mono text-[9px] uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: grp.accent }}>
                <span className="h-1 w-1 rounded-full" style={{ background: grp.accent }} />
                {grp.label}
              </div>
              <div className="space-y-1.5">
                {grp.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => item.tab && onNavigate(item.tab)}
                    disabled={!item.tab}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                      item.tab ? 'hover:bg-[var(--j-panel-soft)] cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span className="text-xs text-[var(--j-text-dim)]">{item.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="jarvis-mono text-[10px] px-1.5 py-0.5 rounded border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] min-w-[20px] text-center"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
          <span>Click any navigation shortcut to jump</span>
          <span className="flex items-center gap-2">
            <kbd className="px-1 py-0.5 rounded border border-[var(--j-border)] bg-[var(--j-panel)]">Esc</kbd>
            <span>to close</span>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
