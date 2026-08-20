"use client";

/**
 * src/components/dashboard/app-sidebar.tsx — Phase 32
 *
 * The Aria Command Center sidebar. Replaces the horizontal tab nav in
 * the legacy 526-line dashboard page.tsx with a collapsible vertical
 * sidebar that:
 *
 *   1. Groups the 15 tabs into 4 logical sections (Command, Operations,
 *      Intelligence, System)
 *   2. Shows real-time status badges (pending approvals, active agents,
 *      system health)
 *   3. Collapses to icon-only on small screens (mobile-friendly)
 *   4. Includes the theme toggle at the bottom
 *
 * ARCHITECTURE
 * ------------
 * - Uses the existing shadcn/ui sidebar primitives (src/components/ui/sidebar.tsx)
 * - Reads tab definitions from the same TABS array used by the dashboard
 * - Status badges come from the Zustand mission store (real-time via SSE)
 *
 * INTEGRATION
 * -----------
 * The dashboard page.tsx is refactored from:
 *   <div className="tab-nav-sticky">...</div>
 *   <main>{activeTab === "..." && ...}</main>
 *
 * to:
 *   <SidebarProvider>
 *     <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
 *     <SidebarInset>
 *       <main>{children}</main>
 *     </SidebarInset>
 *   </SidebarProvider>
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layout,
  Monitor,
  Activity,
  Network,
  Brain,
  Target,
  Megaphone,
  DollarSign,
  TrendingUp,
  Shield,
  GraduationCap,
  MoreHorizontal,
  Settings,
  type LucideIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/mission/theme-toggle";
import { cn } from "@/lib/utils";

// ─── Tab Definitions ─────────────────────────────────────────────────

export interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  section: "command" | "operations" | "intelligence" | "system";
}

export const SIDEBAR_TABS: TabDef[] = [
  // Command
  { id: "overview", label: "Overview", icon: Layout, section: "command" },
  { id: "screen", label: "Live Screen", icon: Monitor, section: "command" },
  { id: "operations", label: "Operations", icon: Activity, section: "command" },
  { id: "agents", label: "Agent Fleet", icon: Network, section: "command" },

  // Operations
  { id: "lead-hunt", label: "Lead Hunt", icon: Target, section: "operations" },
  { id: "proactive", label: "Proactive", icon: Megaphone, section: "operations" },
  { id: "leads", label: "Leads", icon: Target, section: "operations" },
  { id: "revenue", label: "Revenue", icon: DollarSign, section: "operations" },
  { id: "finance", label: "Finance", icon: TrendingUp, section: "operations" },

  // Intelligence
  { id: "intel", label: "Intel", icon: Brain, section: "intelligence" },
  { id: "supervisors", label: "Supervisors", icon: Shield, section: "intelligence" },
  { id: "training", label: "Training", icon: GraduationCap, section: "intelligence" },
  { id: "market", label: "Market Intel", icon: TrendingUp, section: "intelligence" },

  // System
  { id: "security", label: "Security", icon: Shield, section: "system" },
  { id: "more", label: "More", icon: MoreHorizontal, section: "system" },
];

const SECTION_LABELS: Record<TabDef["section"], string> = {
  command: "Command Center",
  operations: "Operations",
  intelligence: "Intelligence",
  system: "System",
};

const SECTION_ORDER: TabDef["section"][] = ["command", "operations", "intelligence", "system"];

// ─── AppSidebar Component ───────────────────────────────────────────

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** Optional status badges to show next to tab labels. */
  statusBadges?: Record<string, number | undefined>;
}

export function AppSidebar({ activeTab, onTabChange, statusBadges }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" className="border-r border-white/5">
      {/* ─── Header: Aria logo + status ─── */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-white font-bold text-sm">
                  A
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">ARIA Mission Control</span>
                  <span className="truncate text-xs text-muted-foreground">Autonomous AI Operations</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      {/* ─── Content: grouped tab sections ─── */}
      <SidebarContent>
        {SECTION_ORDER.map((section) => {
          const sectionTabs = SIDEBAR_TABS.filter((t) => t.section === section);
          if (sectionTabs.length === 0) return null;

          return (
            <SidebarGroup key={section}>
              <SidebarGroupLabel>{SECTION_LABELS[section]}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sectionTabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const badge = statusBadges?.[tab.id];
                    const Icon = tab.icon;

                    return (
                      <SidebarMenuItem key={tab.id}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => onTabChange(tab.id)}
                          tooltip={tab.label}
                        >
                          <Icon className={cn("h-4 w-4", isActive && "text-emerald-400")} />
                          <span>{tab.label}</span>
                          {badge != null && badge > 0 && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-xs font-medium text-emerald-400">
                              {badge > 99 ? "99+" : badge}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {/* ─── Footer: theme toggle + settings ─── */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/dashboard/settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
