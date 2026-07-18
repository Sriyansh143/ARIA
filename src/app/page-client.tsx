'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, LayoutDashboard, Bot, MessageSquare, Sparkles, Database, Gauge,
  CalendarClock, Wallet, HeartPulse, ScrollText, ListTodo, History, FolderArchive,
  Network, Lightbulb, Bell, Search, Command, Menu, X, Cpu, MemoryStick, Zap,
  Radio, ChevronRight, ShieldCheck, CircleDot, LayoutGrid, MessagesSquare,
  Terminal, Sun, Moon, Share2, Workflow, Sliders, Eye, EyeOff, ChevronUp, ChevronDown, Pin, GitBranch, Rocket, BarChart3, Loader2, Star, FileText,
  Copy, DollarSign, Palette, GraduationCap,
  Building2, Gavel, Puzzle, Briefcase, Target,
  CreditCard,
} from 'lucide-react';
import { JARVIS, fmtTime } from '@/lib/config';
import { useApi } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNavStore } from '@/lib/nav-store';

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

export type TabKey =
  | 'overview' | 'fleet' | 'chat' | 'skills' | 'memory' | 'telemetry'
  | 'scheduler' | 'payments' | 'health' | 'logs' | 'tasks' | 'activity'
  | 'artifacts' | 'providers' | 'insights' | 'kanban' | 'comms' | 'runner'
  | 'memory-graph' | 'fleet-topology' | 'chain' | 'task-dag' | 'autonomy' | 'analytics' | 'reports'
  | 'spawned' | 'earnings' | 'branding' | 'teach'
  | 'workforce' | 'learning' | 'rules' | 'plugins' | 'models'
  | 'blackbox' | 'services' | 'apptree' | 'goals' | 'payment-methods' | 'data-mgmt' | 'agent-monitor';

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof Activity;
  group: string;
  accent: string;
}

const TABS: TabDef[] = [
  // ─── Command Center ─── the operator's primary entry points
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Command', accent: JARVIS.colors.cyan },
  { key: 'chat', label: 'JARVIS Chat', icon: MessageSquare, group: 'Command', accent: JARVIS.colors.violet },
  { key: 'activity', label: 'Activity Feed', icon: History, group: 'Command', accent: JARVIS.colors.green },
  { key: 'insights', label: 'AI Insights', icon: Lightbulb, group: 'Command', accent: JARVIS.colors.cyan },

  // ─── Agent Fleet ─── all agent management + inter-agent comms
  { key: 'fleet', label: 'Agent Fleet', icon: Bot, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'fleet-topology', label: 'Fleet Topology', icon: Share2, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'spawned', label: 'Spawned Agents', icon: Copy, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'workforce', label: 'Workforce', icon: Building2, group: 'Fleet', accent: JARVIS.colors.cyan },
  { key: 'comms', label: 'Agent Comms', icon: MessagesSquare, group: 'Fleet', accent: JARVIS.colors.violet },

  // ─── Work ─── task management + goals
  { key: 'tasks', label: 'Tasks', icon: ListTodo, group: 'Work', accent: JARVIS.colors.amber },
  { key: 'kanban', label: 'Kanban Board', icon: LayoutGrid, group: 'Work', accent: JARVIS.colors.amber },
  { key: 'task-dag', label: 'Task DAG', icon: GitBranch, group: 'Work', accent: JARVIS.colors.violet },
  { key: 'goals', label: 'Goals', icon: Target, group: 'Work', accent: JARVIS.colors.cyan },

  // ─── Intelligence ─── AI capabilities + models + autonomy
  { key: 'skills', label: 'Skills Catalog', icon: Sparkles, group: 'Intelligence', accent: JARVIS.colors.cyan },
  { key: 'runner', label: 'Skill Runner', icon: Terminal, group: 'Intelligence', accent: JARVIS.colors.green },
  { key: 'chain', label: 'Skill Pipeline', icon: Workflow, group: 'Intelligence', accent: JARVIS.colors.green },
  { key: 'autonomy', label: 'Autonomy Loop', icon: Rocket, group: 'Intelligence', accent: JARVIS.colors.cyan },
  { key: 'models', label: 'AI Models', icon: Cpu, group: 'Intelligence', accent: JARVIS.colors.cyan },
  { key: 'providers', label: 'AI Providers', icon: Network, group: 'Intelligence', accent: JARVIS.colors.green },

  // ─── Knowledge ─── memory + learning + rules + plugins
  { key: 'memory', label: 'Memory Store', icon: Database, group: 'Knowledge', accent: JARVIS.colors.violet },
  { key: 'memory-graph', label: 'Memory Graph', icon: Network, group: 'Knowledge', accent: JARVIS.colors.violet },
  { key: 'learning', label: 'Learn & Earn', icon: GraduationCap, group: 'Knowledge', accent: JARVIS.colors.cyan },
  { key: 'teach', label: 'Teach', icon: GraduationCap, group: 'Knowledge', accent: JARVIS.colors.violet },
  { key: 'rules', label: 'Operator Rules', icon: Gavel, group: 'Knowledge', accent: JARVIS.colors.amber },
  { key: 'plugins', label: 'Plugins', icon: Puzzle, group: 'Knowledge', accent: JARVIS.colors.violet },
  { key: 'artifacts', label: 'Artifacts', icon: FolderArchive, group: 'Knowledge', accent: JARVIS.colors.amber },

  // ─── Monitoring ─── observability + health + audit
  { key: 'telemetry', label: 'Telemetry', icon: Gauge, group: 'Monitoring', accent: JARVIS.colors.cyan },
  { key: 'health', label: 'Fleet Health', icon: HeartPulse, group: 'Monitoring', accent: JARVIS.colors.green },
  { key: 'logs', label: 'System Logs', icon: ScrollText, group: 'Monitoring', accent: JARVIS.colors.amber },
  { key: 'blackbox', label: 'Black Box', icon: ShieldCheck, group: 'Monitoring', accent: JARVIS.colors.red },
  { key: 'agent-monitor', label: 'Agent Monitor', icon: ShieldCheck, group: 'Monitoring', accent: JARVIS.colors.red },
  { key: 'scheduler', label: 'Scheduler', icon: CalendarClock, group: 'Monitoring', accent: JARVIS.colors.violet },

  // ─── Business ─── revenue + analytics + services
  { key: 'payments', label: 'Payments', icon: Wallet, group: 'Business', accent: JARVIS.colors.green },
  { key: 'payment-methods', label: 'Payout Methods', icon: CreditCard, group: 'Business', accent: JARVIS.colors.green },
  { key: 'earnings', label: 'Earning Methods', icon: DollarSign, group: 'Business', accent: JARVIS.colors.green },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Business', accent: JARVIS.colors.cyan },
  { key: 'reports', label: 'Reports', icon: FileText, group: 'Business', accent: JARVIS.colors.green },
  { key: 'services', label: 'Services Hub', icon: Briefcase, group: 'Business', accent: JARVIS.colors.amber },

  // ─── System ─── admin + configuration
  { key: 'data-mgmt', label: 'Data Management', icon: Database, group: 'System', accent: JARVIS.colors.amber },
  { key: 'branding', label: 'Branding', icon: Palette, group: 'System', accent: JARVIS.colors.violet },
  { key: 'apptree', label: 'App Tree', icon: FolderArchive, group: 'System', accent: JARVIS.colors.cyan },
];

/**
 * Explicit sidebar group order + accent color per group. Without this the
 * sidebar would derive order from the TABS array (fragile). This makes the
 * information architecture intentional: Command → Fleet → Work → Intelligence
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
  overview: OverviewTab,
  fleet: FleetTab,
  chat: ChatTab,
  skills: SkillsTab,
  memory: MemoryTab,
  telemetry: TelemetryTab,
  scheduler: SchedulerTab,
  payments: PaymentsTab,
  'payment-methods': PaymentMethodsTab,
  health: HealthTab,
  logs: LogsTab,
  tasks: TasksTab,
  activity: ActivityTab,
  artifacts: ArtifactsTab,
  providers: ProvidersTab,
  insights: InsightsTab,
  kanban: KanbanTab,
  comms: CommsTab,
  runner: SkillRunnerTab,
  'memory-graph': MemoryGraphTab,
  'fleet-topology': FleetTopologyTab,
  chain: SkillChainTab,
  'task-dag': TaskDagTab,
  autonomy: AutonomyTab,
  analytics: AnalyticsTab,
  reports: ReportsTab,
  spawned: SpawnedAgentsTab,
  earnings: EarningMethodsTab,
  branding: BrandingTab,
  teach: TeachSourceCard,
  workforce: WorkforceTab,
  learning: LearningTab,
  rules: RulesTab,
  plugins: PluginsTab,
  models: ModelsTab,
  blackbox: BlackboxTab,
  services: ServicesHubTab,
  apptree: AppTreeTab,
  goals: GoalsTab,
  'data-mgmt': DataManagementTab,
  'agent-monitor': AgentMonitorTab,
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
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setGlobalSearchOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Orion mode: load persisted preference on mount, then persist on change.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-orion-mode');
      if (raw === '1') setOrionMode(true);
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

          <NotificationsBell open={notifOpen} setOpen={setNotifOpen} />
        </div>
        <div className="h-px jarvis-hr" />
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
      <CommandPalette key={paletteKey} open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />

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

function NotificationsBell({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const { data, refresh } = useApi<{ notifications: Array<{ id: string; type: string; title: string; message: string; read: boolean; createdAt: string }>; unread: number }>('/api/notifications', 10000);
  // Also pull high-priority agent-monitor findings (critical + open) so they
  // surface in the same bell — this is the "every tab is monitored by agents
  // and high-priority items surface to the operator" connection.
  const { data: findingsData } = useApi<{ findings: Array<{ id: string; severity: string; monitorKey: string; tab: string; title: string; detail: string; actionTab?: string; actionMeta?: string; status: string; createdAt: string }> }>(
    '/api/agent-monitors/findings?severity=critical&status=open&limit=5',
    15000,
  );
  const { toast } = useToast();
  const navigate = useNavStore((s) => s.navigate);
  const unread = data?.unread ?? 0;
  const criticalFindings = findingsData?.findings ?? [];
  const totalBadge = unread + criticalFindings.length;

  const markAll = async () => {
    if (!data?.notifications) return;
    await Promise.all(data.notifications.filter((n) => !n.read).map((n) => patchNotif(n.id, true)));
    refresh();
    toast({ title: 'Notifications cleared' });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {totalBadge > 0 && (
          <span className={cn(
            'absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center',
            criticalFindings.length > 0 ? 'bg-[var(--j-red)] jarvis-pulse-dot' : 'bg-[var(--j-amber)]'
          )}>
            {totalBadge}
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
              className="absolute right-0 mt-2 w-80 z-50 jarvis-panel p-0 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--j-border)]">
                <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Notifications</span>
                <button onClick={markAll} className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline">Mark all read</button>
              </div>
              <div className="max-h-96 overflow-y-auto jarvis-scroll">
                {/* Critical agent-monitor findings first — clickable to navigate */}
                {criticalFindings.length > 0 && (
                  <div className="border-b border-[var(--j-red)]/30">
                    <div className="px-3 py-1.5 bg-[var(--j-red)]/10 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-red)] jarvis-pulse-dot" />
                      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-red)] tracking-widest">Agent Alerts · {criticalFindings.length}</span>
                    </div>
                    {criticalFindings.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          navigate(f.actionTab || 'agent-monitor', f.actionMeta ? JSON.parse(f.actionMeta) : { findingId: f.id });
                          setOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-red)]/10 transition-colors block"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="jarvis-mono text-[9px] uppercase px-1 rounded bg-[var(--j-red)]/20 text-[var(--j-red)]">{f.monitorKey}</span>
                          <span className="text-xs font-medium text-[var(--j-text)] truncate flex-1">{f.title}</span>
                        </div>
                        <div className="text-[11px] text-[var(--j-text-dim)] line-clamp-2">{f.detail}</div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] mt-1">→ {f.actionTab || 'agent-monitor'} tab</div>
                      </button>
                    ))}
                  </div>
                )}
                {/* Regular notifications */}
                {data?.notifications?.length ? (
                  data.notifications.map((n) => (
                    <div key={n.id} className={cn('px-3 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/60', !n.read && 'bg-[var(--j-cyan)]/5')}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: notifColor(n.type) }} />
                        <span className="text-xs font-medium text-[var(--j-text)]">{n.title}</span>
                        {!n.read && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--j-cyan)]" />}
                      </div>
                      <div className="text-[11px] text-[var(--j-text-dim)]">{n.message}</div>
                    </div>
                  ))
                ) : criticalFindings.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-[var(--j-text-mute)]">No notifications</div>
                ) : null}
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
function CommandPalette({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (t: TabKey) => void }) {
  // Fresh mount (via key in parent) ensures q/sel start empty each open.
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const results = useMemo(() => {
    const ql = q.toLowerCase();
    return TABS.filter((t) => !ql || t.label.toLowerCase().includes(ql) || t.group.toLowerCase().includes(ql));
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) onNavigate(r.key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, sel, onNavigate]);

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
            <div className="max-h-72 overflow-y-auto jarvis-scroll p-2">
              {results.length ? results.map((t, i) => {
                const Icon = t.icon;
                const active = i === sel;
                return (
                  <button
                    key={t.key}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => onNavigate(t.key)}
                    className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors', active ? 'bg-[var(--j-panel-soft)] text-[var(--j-text)]' : 'text-[var(--j-text-dim)]')}
                  >
                    <Icon className="h-4 w-4" style={{ color: active ? t.accent : undefined }} />
                    <span className="flex-1 text-left">{t.label}</span>
                    <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{t.group}</span>
                  </button>
                );
              }) : (
                <div className="px-3 py-8 text-center text-xs text-[var(--j-text-mute)]">No results</div>
              )}
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
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
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
    if (!open) { setQ(''); setResults([]); setSel(0); return; }
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = await res.json();
        setResults(json.results ?? []);
        setSel(0);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [q, open]);

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

  const typeIcon: Record<string, typeof Bot> = { agent: Bot, task: ListTodo, memory: Database, comms: MessagesSquare, skill: Sparkles };

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
