"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { useMissionControl } from "@/hooks/use-mission-control";
import { useMissionStore } from "@/stores/mission-store";
import { useOnboarding } from "@/hooks/use-onboarding";
import { BootBoundary } from "@/components/mission/boot-boundary";
import { OnboardingGate } from "@/components/mission/onboarding-gate";
import { LazyMount } from "@/components/mission/lazy-mount";
import { MissionHeader } from "@/components/mission/mission-header";
import { PrimaryStatsBar } from "@/components/mission/primary-stats-bar";
import { SpeakingAssistant } from "@/components/mission/speaking-assistant";
import { useAlertNotifications } from "@/hooks/use-alert-notifications";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Terminal,
  Shield,
  Activity,
  Layout,
  Network,
  Brain,
  DollarSign,
  GraduationCap,
  Monitor,
  MoreHorizontal,
  Settings,
  Rocket,
  Target,
  Megaphone,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ─── Lazy-loaded tab content ────────────────────────────────────────
// Phase 32: replaced inline PanelSkeleton with the shared SkeletonLoader component.
const PanelSkeleton = ({ label }: { label: string }) => (
  <section className="mc-surface flex flex-col">
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
      <div className="h-3 w-3 animate-pulse rounded bg-border/40" />
      <div className="h-3 w-32 animate-pulse rounded bg-border/40" />
    </div>
    <div className="space-y-2 p-4">
      <div className="h-4 w-full animate-pulse rounded bg-border/30" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-border/30" />
    </div>
    <div className="px-4 pb-2 text-[9px] text-muted-foreground/50">loading {label}…</div>
  </section>
);

// Tab 1: Overview (OptimalEngine + C-suite + animations)
const OptimalEngine = dynamic(() => import("@/components/mission/optimal-engine").then((m) => m.OptimalEngine), { loading: () => <PanelSkeleton label="Optimal Engine" />, ssr: false });
const CsuiteMeeting = dynamic(() => import("@/components/mission/csuite-meeting").then((m) => m.CsuiteMeeting), { loading: () => <PanelSkeleton label="C-Suite Meeting" />, ssr: false });
const ResearchAnimation = dynamic(() => import("@/components/mission/research-animation").then((m) => m.ResearchAnimation), { loading: () => <PanelSkeleton label="Research Lab" />, ssr: false });
const EmployeesAnimation = dynamic(() => import("@/components/mission/employees-animation").then((m) => m.EmployeesAnimation), { loading: () => <PanelSkeleton label="Office Floor" />, ssr: false });

// Tab 2: Live Screen (NEW — Gemini-style screen sharing + VLM interaction)
const LiveScreenPanel = dynamic(() => import("@/components/mission/live-screen-panel").then((m) => ({ default: m.LiveScreenPanel })), { loading: () => <PanelSkeleton label="Live Screen" />, ssr: false });

// Tab 3: Operations (tasks + approvals + workflows)
const TaskPipeline = dynamic(() => import("@/components/mission/task-pipeline").then((m) => ({ default: m.TaskPipeline })), { ssr: false });
const ApprovalsQueue = dynamic(() => import("@/components/mission/task-pipeline").then((m) => ({ default: m.ApprovalsQueue })), { ssr: false });
const WorkflowPanel = dynamic(() => import("@/components/mission/workflow-panel").then((m) => ({ default: m.WorkflowPanel })), { ssr: false });
const TaskDagView = dynamic(() => import("@/components/mission/task-dag-view").then((m) => ({ default: m.TaskDagView })), { ssr: false });
const AgentCommandConsole = dynamic(() => import("@/components/mission/agent-command-console").then((m) => ({ default: m.AgentCommandConsole })), { ssr: false });
// v61 Phase 1 (Audit #4): The ApprovalBriefPanel is already built (391 lines)
// but was never rendered. Dynamic-import + render it so the owner can ask
// questions / clarify / suggest improvements BEFORE approving.
const ApprovalBriefPanel = dynamic(() => import("@/components/mission/approval-brief-panel").then((m) => ({ default: m.ApprovalBriefPanel })), { ssr: false });

// Tab 4: Agents (roster + network + leaderboard)
const AgentRoster = dynamic(() => import("@/components/mission/agent-roster").then((m) => ({ default: m.AgentRoster })), { ssr: false });
const AgentNetworkGraph = dynamic(() => import("@/components/mission/agent-network-graph").then((m) => ({ default: m.AgentNetworkGraph })), { ssr: false });
const AgentPerformanceLeaderboard = dynamic(() => import("@/components/mission/agent-leaderboard").then((m) => ({ default: m.AgentPerformanceLeaderboard })), { ssr: false });

// Tab 5: Intelligence (memory + skills + metrics)
const MemoryNetworkGraph = dynamic(() => import("@/components/mission/memory-network-graph").then((m) => ({ default: m.MemoryNetworkGraph })), { ssr: false });
const MetricsDashboard = dynamic(() => import("@/components/mission/metrics-dashboard").then((m) => ({ default: m.MetricsDashboard })), { ssr: false });
const SystemHealthGauge = dynamic(() => import("@/components/mission/system-health-gauge").then((m) => ({ default: m.SystemHealthGauge })), { ssr: false });

// Tab 6: Finance (revenue + costs + deals)
const FinancialDashboard = dynamic(() => import("@/components/mission/financial-dashboard").then((m) => ({ default: m.FinancialDashboard })), { ssr: false });
const DealKanbanPanel = dynamic(() => import("@/components/mission/deal-kanban-panel").then((m) => ({ default: m.DealKanbanPanel })), { ssr: false });
const RevenueForecast = dynamic(() => import("@/components/mission/revenue-forecast").then((m) => ({ default: m.RevenueForecast })), { ssr: false });
const CostProfitAnalysis = dynamic(() => import("@/components/mission/cost-profit-analysis").then((m) => ({ default: m.CostProfitAnalysis })), { ssr: false });

// Tab 10: Training (blackbox + agent teaching)
const BlackboxTrainingPanel = dynamic(() => import("@/components/mission/blackbox-training-panel").then((m) => ({ default: m.BlackboxTrainingPanel })), { ssr: false });

// ─── On-demand panels (loaded only when "More" tab is opened) ───────
// System + Advanced tabs moved here — keeps the main nav clean.
const SettingsPanel = dynamic(() => import("@/components/mission/settings-panel").then((m) => ({ default: m.SettingsPanel })), { ssr: false });
const SystemMetricsPanel = dynamic(() => import("@/components/mission/system-metrics-panel").then((m) => ({ default: m.SystemMetricsPanel })), { ssr: false });
const AuditLogPanel = dynamic(() => import("@/components/mission/audit-log-panel").then((m) => ({ default: m.AuditLogPanel })), { ssr: false });
const AlertsPanel = dynamic(() => import("@/components/mission/operations-panels").then((m) => ({ default: m.AlertsPanel })), { ssr: false });
const CronRegistry = dynamic(() => import("@/components/mission/operations-panels").then((m) => ({ default: m.CronRegistry })), { ssr: false });
const LlmCallInspector = dynamic(() => import("@/components/mission/llm-call-inspector").then((m) => ({ default: m.LlmCallInspector })), { ssr: false });
const GoalsPanel = dynamic(() => import("@/components/mission/goals-panel").then((m) => ({ default: m.GoalsPanel })), { ssr: false });
const AutonomousBusinessPanel = dynamic(() => import("@/components/mission/autonomous-business-panel").then((m) => ({ default: m.AutonomousBusinessPanel })), { ssr: false });
const DebatePanel = dynamic(() => import("@/components/mission/debate-panel").then((m) => ({ default: m.DebatePanel })), { ssr: false });
const CashClawPanel = dynamic(() => import("@/components/mission/cash-claw-panel").then((m) => ({ default: m.CashClawPanel })), { ssr: false });
const RevenueEnginePanel = dynamic(() => import("@/components/mission/revenue-engine-panel").then((m) => ({ default: m.RevenueEnginePanel })), { ssr: false });
const CredentialVaultPanel = dynamic(() => import("@/components/mission/credential-vault-panel").then((m) => ({ default: m.CredentialVaultPanel })), { ssr: false });
const ConnectorMarketplacePanel = dynamic(() => import("@/components/mission/connector-marketplace-panel").then((m) => ({ default: m.ConnectorMarketplacePanel })), { ssr: false });
const AiInsightsPanel = dynamic(() => import("@/components/mission/ai-insights-panel").then((m) => ({ default: m.AiInsightsPanel })), { ssr: false });
const ResearchLearningPanel = dynamic(() => import("@/components/mission/research-learning-panel").then((m) => ({ default: m.ResearchLearningPanel })), { ssr: false });
const KnowledgeBasePanel = dynamic(() => import("@/components/mission/knowledge-base-panel").then((m) => ({ default: m.KnowledgeBasePanel })), { ssr: false });
const ActivityStreamPanel = dynamic(() => import("@/components/mission/activity-stream-panel").then((m) => ({ default: m.ActivityStreamPanel })), { ssr: false });
const AgentAnalyticsPanel = dynamic(() => import("@/components/mission/agent-analytics-panel").then((m) => ({ default: m.AgentAnalyticsPanel })), { ssr: false });
const CostDashboardPanel = dynamic(() => import("@/components/mission/cost-dashboard-panel").then((m) => ({ default: m.CostDashboardPanel })), { ssr: false });
const SampleDataManager = dynamic(() => import("@/components/mission/sample-data-manager").then((m) => ({ default: m.SampleDataManager })), { ssr: false });
const NotificationPreferences = dynamic(() => import("@/components/mission/notification-preferences").then((m) => ({ default: m.NotificationPreferences })), { ssr: false });
const ActivityHeatmap = dynamic(() => import("@/components/mission/activity-heatmap").then((m) => ({ default: m.ActivityHeatmap })), { ssr: false });
const ApiDocsPanel = dynamic(() => import("@/components/mission/api-docs-panel").then((m) => ({ default: m.ApiDocsPanel })), { ssr: false });
const MultiCompanyCyclesPanel = dynamic(() => import("@/components/mission/multi-company-cycles-panel").then((m) => ({ default: m.MultiCompanyCyclesPanel })), { ssr: false });
const WorkflowTemplatesPanel = dynamic(() => import("@/components/mission/workflow-templates-panel").then((m) => ({ default: m.WorkflowTemplatesPanel })), { ssr: false });
const SystemAccessPanel = dynamic(() => import("@/components/mission/system-access-panel").then((m) => ({ default: m.SystemAccessPanel })), { ssr: false });
const FailureAlchemyPanel = dynamic(() => import("@/components/mission/failure-alchemy-panel").then((m) => ({ default: m.FailureAlchemyPanel })), { ssr: false });
const NotesPanel = dynamic(() => import("@/components/mission/notes-panel").then((m) => ({ default: m.NotesPanel })), { ssr: false });
const KpiPanel = dynamic(() => import("@/components/mission/kpi-panel").then((m) => ({ default: m.KpiPanel })), { ssr: false });
const AgentCapabilityMatrix = dynamic(() => import("@/components/mission/capability-matrix").then((m) => ({ default: m.AgentCapabilityMatrix })), { ssr: false });

// Overlays
const CommandPalette = dynamic(() => import("@/components/mission/command-palette").then((m) => m.CommandPalette), { ssr: false });
const AgentDetailDrawer = dynamic(() => import("@/components/mission/agent-detail-drawer").then((m) => m.AgentDetailDrawer), { ssr: false });
const TaskComposer = dynamic(() => import("@/components/mission/task-composer").then((m) => m.TaskComposer), { ssr: false });
const KeyboardShortcutsHelp = dynamic(() => import("@/components/mission/keyboard-shortcuts-help").then((m) => m.KeyboardShortcutsHelp), { ssr: false });
const OnboardingTour = dynamic(() => import("@/components/mission/onboarding-tour").then((m) => m.OnboardingTour), { ssr: false });
const LiveVoiceChat = dynamic(() => import("@/components/mission/live-voice-chat").then((m) => m.LiveVoiceChat), { ssr: false });
const MobileBottomNav = dynamic(() => import("@/components/mission/mobile-bottom-nav").then((m) => m.MobileBottomNav), { ssr: false });
const AgentActivityTicker = dynamic(() => import("@/components/mission/agent-activity-ticker").then((m) => m.AgentActivityTicker), { ssr: false });
const QuickActionFAB = dynamic(() => import("@/components/mission/quick-action-fab").then((m) => m.QuickActionFAB), { ssr: false });
const SystemHealthBanner = dynamic(() => import("@/components/mission/system-health-banner").then((m) => m.SystemHealthBanner), { ssr: false });

// v41: New UI panels — Security (2FA+RBAC), LeadFinder, NotificationCenter, RefundButton
const SecurityPanel = dynamic(() => import("@/components/mission/security-panel").then((m) => ({ default: m.SecurityPanel })), { ssr: false });
const RbacPanel = dynamic(() => import("@/components/mission/rbac-panel").then((m) => ({ default: m.RbacPanel })), { ssr: false });
const LeadFinderPanel = dynamic(() => import("@/components/mission/lead-finder-panel").then((m) => ({ default: m.LeadFinderPanel })), { ssr: false });
// v43: Revenue Loop dashboard
const RevenueLoopPanel = dynamic(() => import("@/components/mission/revenue-loop-panel").then((m) => ({ default: m.RevenueLoopPanel })), { ssr: false });

// v56: Intelligence panels
const SupervisorsPanel = dynamic(() => import("@/components/mission/intelligence/supervisors-panel").then((m) => ({ default: m.SupervisorsPanel })), { loading: () => <PanelSkeleton label="Supervisors" />, ssr: false });
const TrainingPanel = dynamic(() => import("@/components/mission/intelligence/training-panel").then((m) => ({ default: m.TrainingPanel })), { loading: () => <PanelSkeleton label="Training" />, ssr: false });
const MarketIntelligencePanel = dynamic(() => import("@/components/mission/intelligence/market-panel").then((m) => ({ default: m.MarketIntelligencePanel })), { loading: () => <PanelSkeleton label="Market Intel" />, ssr: false });
// v71 Phase 21 (RULE-69): Autonomous Lead Hunt dashboard.
const DynamicLeadHuntDashboard = dynamic(() => import("@/app/dashboard/lead-hunt/page").then((m) => ({ default: m.default })), { loading: () => <PanelSkeleton label="Lead Hunt" />, ssr: false });
// v72 Phase 22 (RULE-70): Proactive Lead Generation dashboard.
const DynamicProactiveDashboard = dynamic(() => import("@/app/dashboard/proactive/page").then((m) => ({ default: m.default })), { loading: () => <PanelSkeleton label="Proactive" />, ssr: false });

// ─── Tab definitions (v56: +Supervisors, +Market Intel tabs) ───────
const TABS = [
  { id: "overview", label: "Overview", icon: Layout },
  { id: "screen", label: "Live Screen", icon: Monitor },
  { id: "operations", label: "Operations", icon: Activity },
  { id: "agents", label: "Agents", icon: Network },
  { id: "intel", label: "Intel", icon: Brain },
  { id: "lead-hunt", label: "Lead Hunt", icon: Target }, // v71 Phase 21 (RULE-69)
  { id: "proactive", label: "Proactive", icon: Megaphone }, // v72 Phase 22 (RULE-70)
  { id: "leads", label: "Leads", icon: Target },
  { id: "revenue", label: "Revenue", icon: DollarSign },
  { id: "finance", label: "Finance", icon: TrendingUp },
  { id: "supervisors", label: "Supervisors", icon: Shield },
  { id: "training", label: "Training", icon: GraduationCap },
  { id: "market", label: "Market Intel", icon: TrendingUp },
  { id: "security", label: "Security", icon: Shield },
  { id: "more", label: "More", icon: MoreHorizontal },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Home() {
  const { booting, bootError } = useMissionControl();
  const reconnect = useMissionStore((s) => s.connection);
  const { onboarded, loading: onboardingLoading, refetch: refetchOnboarding } = useOnboarding();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  // v61 Phase 1 (Audit #4): track which approval's brief panel is open
  // so the owner can ask questions / clarify / suggest improvements BEFORE approving.
  const [briefApprovalId, setBriefApprovalId] = useState<string | null>(null);

  useAlertNotifications();

  const onRetry = useCallback(() => window.location.reload(), []);

  const handleOnboardingComplete = useCallback(() => {
    void refetchOnboarding().then(() => {
      fetch("/api/seed", { cache: "no-store" }).then(() => window.location.reload());
    });
  }, [refetchOnboarding]);

  const jumpTo = useCallback((target: string) => {
    const tabMap: Record<string, TabId> = {
      "neural-graph": "overview",
      "task-pipeline": "operations",
      "approval-queue": "operations",
      "agent-fleet": "agents",
      "memory-network": "intel",
      "financial": "finance",
    };
    const tab = tabMap[target] || "overview";
    setActiveTab(tab);
  }, []);

  // Keyboard shortcuts: 1-8 jumps to tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (booting || bootError || !onboarded) return;
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= TABS.length) {
        e.preventDefault();
        setActiveTab(TABS[num - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [booting, bootError, onboarded]);

  if (!booting && !bootError && !onboardingLoading && !onboarded) {
    return <OnboardingGate onComplete={handleOnboardingComplete} />;
  }

  // Phase 32: wrap the dashboard in SidebarProvider + AppSidebar + SidebarInset.
  // The legacy horizontal tab nav is preserved as a fallback (when sidebar is collapsed)
  // but the sidebar is now the primary navigation.
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar activeTab={activeTab} onTabChange={(t) => setActiveTab(t as TabId)} />
      <SidebarInset className="mc-grid-bg relative flex min-h-screen flex-col">
        {/* Animated background glow orbs (Skills Studio aesthetic) */}
        <div className="aria-glow-orb aria-glow-orb-emerald aria-animate-pulse-glow" style={{ top: "5%", left: "15%", width: "20rem", height: "20rem" }} />
        <div className="aria-glow-orb aria-glow-orb-violet aria-animate-pulse-glow" style={{ top: "40%", right: "10%", width: "18rem", height: "18rem", animationDelay: "2s" }} />

        {/* Phase 32: sidebar trigger + MissionHeader */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <SidebarTrigger />
          <div className="flex-1">
            <MissionHeader onJumpTo={jumpTo} />
          </div>
        </div>

      {/* v41: NotificationCenter is rendered inside MissionHeader */}

      {/* Stats bar */}
      {!booting && !bootError && onboarded && (
        <div className="relative z-10 space-y-2 pt-3">
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6">
            <PrimaryStatsBar onJumpTo={jumpTo} />
          </div>
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6">
            <SystemHealthBanner />
          </div>
        </div>
      )}

      {/* Tab navigation — Skills Studio style (rounded, gradient active) */}
      {!booting && !bootError && onboarded && (
        <div className="tab-nav-sticky sticky z-20 border-b border-border/40 aria-glass">
          <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-4 py-2 sm:px-6 scrollbar-custom">
            {TABS.map((tab, tabIdx) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const shortcutNum = tabIdx + 1;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={`Press ${shortcutNum} to switch`}
                  className={`group relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600"
                      transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                    />
                  )}
                  <Icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{tab.label}</span>
                  <span className={`relative ml-0.5 hidden rounded px-1 text-[8px] font-bold tabular-nums sm:inline-block ${isActive ? "bg-white/20" : "bg-border/30 text-muted-foreground/50"}`}>
                    {shortcutNum}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 sm:px-6">
        <BootBoundary booting={booting} bootError={bootError} onRetry={onRetry}>
          {/* Persistent live activity strip */}
          {!booting && !bootError && onboarded && (
            <div className="mb-3">
              <AgentActivityTicker />
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {/* Phase 32: wrap each tab in ErrorBoundary so a panel crash
                  doesn't kill the entire dashboard. The error is logged to
                  /api/blackbox + a retry button is shown. */}
              <ErrorBoundary key={activeTab}>
              {/* Tab 1: Overview — OptimalEngine + C-suite + animations */}
              {activeTab === "overview" && (
                <>
                  <SpeakingAssistant />
                  <div id="neural-graph" className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                    <div className="xl:col-span-2"><OptimalEngine onOpenAgent={setDrawerAgentId} /></div>
                    <div className="xl:col-span-1"><CsuiteMeeting /></div>
                  </div>
                  <LazyMount height={450}><ResearchAnimation /></LazyMount>
                  <LazyMount height={500}><EmployeesAnimation /></LazyMount>
                </>
              )}

              {/* Tab 2: Live Screen — Gemini-style screen sharing + VLM */}
              {activeTab === "screen" && (
                <LiveScreenPanel />
              )}

              {/* Tab 3: Operations */}
              {activeTab === "operations" && (
                <>
                  <AgentCommandConsole />
                  <ActivityStreamPanel />
                  <WorkflowPanel />
                  <LazyMount height={400}><TaskDagView onJumpToTask={() => jumpTo("task-pipeline")} /></LazyMount>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div id="task-pipeline"><TaskPipeline onCreateTask={() => setComposerOpen(true)} onOpenTask={() => {}} /></div>
                    <div id="approval-queue"><ApprovalsQueue onOpenBrief={(id) => setBriefApprovalId(id)} /></div>
                  </div>
                </>
              )}

              {/* Tab 4: Agents */}
              {activeTab === "agents" && (
                <>
                  <AgentAnalyticsPanel />
                  <div id="agent-fleet"><AgentRoster onOpenAgent={setDrawerAgentId} /></div>
                  <AgentNetworkGraph />
                  <LazyMount height={400}><AgentCapabilityMatrix /></LazyMount>
                  <LazyMount height={350}><AgentPerformanceLeaderboard /></LazyMount>
                </>
              )}

              {/* Tab 5: Intelligence */}
              {activeTab === "intel" && (
                <>
                  <AiInsightsPanel />
                  <ResearchLearningPanel />
                  <LazyMount height={400}><MemoryNetworkGraph /></LazyMount>
                  <LazyMount height={350}><MetricsDashboard /></LazyMount>
                  <LazyMount height={300}><SystemHealthGauge /></LazyMount>
                  <KnowledgeBasePanel />
                </>
              )}

              {/* Tab 6: Finance */}
              {activeTab === "finance" && (
                <>
                  <CostDashboardPanel />
                  <DealKanbanPanel />
                  <div id="financial"><FinancialDashboard onOpenDeal={() => {}} /></div>
                  <LazyMount height={300}><RevenueForecast /></LazyMount>
                  <LazyMount height={300}><CostProfitAnalysis /></LazyMount>
                </>
              )}

              {/* Tab 10: Training */}
              {activeTab === "training" && (
                <>
                  <BlackboxTrainingPanel />
                </>
              )}

              
              {/* v71 Phase 21 (RULE-69): Autonomous Lead Hunt — multi-agent qualification */}
              {activeTab === "lead-hunt" && (
                <DynamicLeadHuntDashboard />
              )}

              {/* v72 Phase 22 (RULE-70): Proactive Lead Generation — Google Maps + Excel imports + free offers + social */}
              {activeTab === "proactive" && (
                <DynamicProactiveDashboard />
              )}

              {activeTab === "leads" && (
                <LeadFinderPanel />
              )}

              {/* v43: Revenue Loop — autonomous outreach funnel + analytics */}
              {activeTab === "revenue" && (
                <RevenueLoopPanel />
              )}

              
              {/* v56: Intelligence tabs */}
              {activeTab === "supervisors" && (
                <SupervisorsPanel />
              )}

              {activeTab === "training" && (
                <TrainingPanel />
              )}

              {activeTab === "market" && (
                <MarketIntelligencePanel />
              )}

              {activeTab === "security" && (
                <>
                  <SecurityPanel />
                  <RbacPanel />
                </>
              )}

              {/* Tab 9: More — System + Advanced (on-demand) */}
              {activeTab === "more" && (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <Settings className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-bold">System & Advanced Tools</h3>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
                      on-demand
                    </Badge>
                  </div>
                  <SettingsPanel />
                  <SampleDataManager />
                  <SystemMetricsPanel />
                  <AuditLogPanel />
                  <LazyMount height={350}><NotificationPreferences /></LazyMount>
                  <LazyMount height={350}><AlertsPanel /></LazyMount>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <LazyMount height={350}><LlmCallInspector /></LazyMount>
                    <LazyMount height={350}><CronRegistry /></LazyMount>
                  </div>
                  <LazyMount height={300}><SystemHealthGauge /></LazyMount>
                  <LazyMount height={350}><ActivityHeatmap /></LazyMount>
                  <LazyMount height={400}><ApiDocsPanel /></LazyMount>

                  {/* Advanced capabilities */}
                  <div className="mt-4 mb-2 flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-violet-400" />
                    <h3 className="text-sm font-bold">Advanced Capabilities</h3>
                  </div>
                  <GoalsPanel />
                  <div id="autonomous-business"><AutonomousBusinessPanel /></div>
                  <MultiCompanyCyclesPanel />
                  <WorkflowTemplatesPanel />
                  <ConnectorMarketplacePanel />
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <RevenueEnginePanel />
                    <CashClawPanel />
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <LazyMount height={350}><DebatePanel /></LazyMount>
                    <LazyMount height={350}><FailureAlchemyPanel /></LazyMount>
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <LazyMount height={350}><CredentialVaultPanel /></LazyMount>
                    <LazyMount height={350}><SystemAccessPanel /></LazyMount>
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <LazyMount height={350}><NotesPanel /></LazyMount>
                    <LazyMount height={350}><KpiPanel /></LazyMount>
                  </div>
                </>
              )}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </BootBoundary>
      </main>

      {/* Global overlays */}
      {!booting && !bootError && (
        <QuickActionFAB onCreateTask={() => setComposerOpen(true)} />
      )}
      <CommandPalette onOpenAgent={setDrawerAgentId} onJumpTo={jumpTo} onCreateTask={() => setComposerOpen(true)} />
      <AgentDetailDrawer agentId={drawerAgentId} onClose={() => setDrawerAgentId(null)} />
      {/* v61 Phase 1 (Audit #4): Render the existing ApprovalBriefPanel so the
          owner can read the LLM-generated brief + ask questions / clarify /
          suggest improvements BEFORE approving. Previously this 391-line
          component was built but never rendered (onOpenBrief was a no-op). */}
      {briefApprovalId && (
        <ApprovalBriefPanel approvalId={briefApprovalId} onClose={() => setBriefApprovalId(null)} />
      )}
      <TaskComposer open={composerOpen} onOpenChange={setComposerOpen} prefillAssigneeId={null} prefillKind={null} />
      <KeyboardShortcutsHelp />
      <OnboardingTour />
      <LiveVoiceChat />

      {!booting && !bootError && <MobileBottomNav onJumpTo={jumpTo} />}
      <MissionFooter connection={reconnect} />
      </SidebarInset>
    </SidebarProvider>
  );
}

function MissionFooter({ connection }: { connection: string }) {
  const connected = connection === "open";
  return (
    <footer className="relative z-10 mt-auto border-t border-border/40 aria-glass">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-2 px-4 py-3 sm:flex-row sm:px-6">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Terminal className="h-3 w-3" />
            ARIA Mission Control
          </span>
          <span className="text-border">·</span>
          <span>v67 · Open-Source Enterprise</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-emerald-400" />
            zero-patch policy
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1.5">
            <div className={`aria-live-dot ${connected ? "" : "bg-amber-400"}`} />
            {connected ? "event stream live" : "reconnecting…"}
          </span>
        </div>
      </div>
    </footer>
  );
}
