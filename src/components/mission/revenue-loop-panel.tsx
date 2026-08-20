"use client"

/**
 * RevenueLoopPanel — the autonomous revenue pipeline dashboard.
 *
 * Shows the full funnel: Leads → Contacted → Replied → Booked → Revenue
 * + industry feedback (which industries convert best)
 * + recent outreach activity
 *
 * Fetches from /api/revenue-loop.
 */

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import {
  Send,
  Mail,
  Reply,
  CalendarCheck,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Loader2,
  Target,
  Trophy,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"

interface RevenueLoopData {
  outreach: {
    totalSent: number
    totalContacted: number
    totalReplied: number
    totalBooked: number
    totalClosedLost: number
    last24h: number
    replyRate: number
    bookingRate: number
  }
  revenue: {
    totalCollectedCents: number
    pendingCents: number
    refundedCount: number
    orderCount: number
  }
  recentActivity: Array<{
    id: string
    title: string
    completedAt: string | null
    result: string | null
  }>
  industryFeedback: Array<{
    industry: string
    total: number
    replied: number
    booked: number
    closed: number
    replyRate: number
    bookingRate: number
  }>
}

export function RevenueLoopPanel() {
  const [data, setData] = useState<RevenueLoopData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/revenue-loop")
      if (res.ok) {
        setData(await res.json())
      }
    } catch {
      toast.error("Failed to load revenue data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading && !data) {
    return (
      <Card className="aria-feature-card flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </Card>
    )
  }

  if (!data) {
    return (
      <Card className="aria-feature-card p-8 text-center text-muted-foreground">
        No revenue data yet.
      </Card>
    )
  }

  const stats = [
    {
      icon: Send,
      label: "Emails Sent",
      value: data.outreach.totalSent,
      sub: `${data.outreach.last24h} in last 24h`,
      color: "#34d399",
    },
    {
      icon: Mail,
      label: "Contacted",
      value: data.outreach.totalContacted,
      sub: `${data.outreach.replyRate.toFixed(1)}% reply rate`,
      color: "#22d3ee",
    },
    {
      icon: Reply,
      label: "Replied",
      value: data.outreach.totalReplied,
      sub: `${data.outreach.bookingRate.toFixed(1)}% booking rate`,
      color: "#a78bfa",
    },
    {
      icon: CalendarCheck,
      label: "Booked",
      value: data.outreach.totalBooked,
      sub: "meetings scheduled",
      color: "#fbbf24",
    },
    {
      icon: DollarSign,
      label: "Revenue",
      value: `$${(data.revenue.totalCollectedCents / 100).toFixed(2)}`,
      sub: `${data.revenue.orderCount} orders`,
      color: "#34d399",
    },
  ]

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card className="aria-feature-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 aria-glow-emerald">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Revenue Loop</h3>
              <p className="text-xs text-muted-foreground">
                Autonomous outreach → reply → booking → payment pipeline
              </p>
            </div>
          </div>
          <Button onClick={() => void loadData()} variant="outline" size="sm">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </Card>

      {/* Funnel stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat, i) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="aria-stat-card"
            >
              <div
                className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${stat.color}15`, color: stat.color }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-xl font-bold tabular-nums">{stat.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
              <div className="mt-0.5 text-[9px] text-muted-foreground/70">{stat.sub}</div>
            </motion.div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Recent activity */}
        <Card className="aria-feature-card p-0">
          <div className="border-b border-border/40 px-4 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Send className="h-3.5 w-3.5 text-emerald-400" />
              Recent Outreach Activity
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto scrollbar-custom p-3">
            {data.recentActivity.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No outreach sent yet. The OutreachExecutor runs hourly.
              </p>
            ) : (
              <div className="space-y-2">
                {data.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-2 rounded-lg border border-border/30 p-2">
                    <Send className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-medium">{activity.title}</p>
                      {activity.result && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{activity.result}</p>
                      )}
                      {activity.completedAt && (
                        <p className="mt-0.5 text-[9px] text-muted-foreground/60">
                          {new Date(activity.completedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Industry feedback (LLM feedback loop) */}
        <Card className="aria-feature-card p-0">
          <div className="border-b border-border/40 px-4 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Target className="h-3.5 w-3.5 text-violet-400" />
              Industry Conversion Feedback
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto scrollbar-custom p-3">
            {data.industryFeedback.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No industry data yet. Leads will appear here once outreach starts.
              </p>
            ) : (
              <div className="space-y-2">
                {data.industryFeedback.slice(0, 10).map((ind) => (
                  <div key={ind.industry} className="rounded-lg border border-border/30 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium capitalize">{ind.industry}</span>
                      {ind.bookingRate > 0 && (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[9px] text-emerald-300">
                          <Trophy className="mr-0.5 h-2.5 w-2.5" />
                          {ind.bookingRate.toFixed(0)}% booked
                        </Badge>
                      )}
                    </div>
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{ind.total} leads</span>
                      <span>·</span>
                      <span>{ind.replied} replied</span>
                      <span>·</span>
                      <span>{ind.booked} booked</span>
                    </div>
                    <Progress value={ind.replyRate} className="h-1.5" style={{ color: "#34d399" }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Revenue summary */}
      <Card className="aria-feature-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</p>
            <p className="text-xl font-bold text-emerald-400">
              ${(data.revenue.totalCollectedCents / 100).toFixed(2)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p>
            <p className="text-xl font-bold text-amber-400">
              ${(data.revenue.pendingCents / 100).toFixed(2)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Orders</p>
            <p className="text-xl font-bold">{data.revenue.orderCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Refunded</p>
            <p className="text-xl font-bold text-rose-400">{data.revenue.refundedCount}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
