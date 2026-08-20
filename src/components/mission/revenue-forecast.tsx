"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { compact } from "@/hooks/use-clock";
import { TrendingUp, TrendingDown, Sparkles, ArrowUpRight } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

/**
 * RevenueForecast — predictive revenue projection with confidence bands.
 *
 * Uses the historical revenue events to compute a simple linear-regression
 * forecast for the next N periods, plus an upper/lower confidence band
 * based on historical variance. Renders:
 *  1. Forecast KPI cards (projected MRR, growth rate, confidence)
 *  2. Area chart with historical (solid) + forecast (dashed) + confidence band
 *
 * The model is intentionally lightweight (linear extrapolation with
 * variance-based bands) — suitable for a live dashboard, not financial
 * advice. The visual is the point: a striking projection that makes the
 * autonomous company's trajectory tangible.
 */

const FORECAST_PERIODS = 8;

interface ForecastPoint {
  t: string;
  actual: number | null;
  forecast: number | null;
  upper: number | null;
  lower: number | null;
  isForecast: boolean;
}

export function RevenueForecast() {
  const revenueEvents = useMissionStore((s) => s.revenueEvents);

  const { series, projected, growthRate, confidence, totalProjected } = useMemo(() => {
    if (revenueEvents.length < 2) {
      return { series: [] as ForecastPoint[], projected: 0, growthRate: 0, confidence: 0, totalProjected: 0 };
    }

    // Bucket historical revenue by time (newest last).
    const sorted = [...revenueEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const bucketCount = Math.min(12, Math.max(4, Math.floor(sorted.length / 2)));
    const bucketSize = Math.ceil(sorted.length / bucketCount);
    const historical: { t: string; value: number }[] = [];
    for (let i = 0; i < sorted.length; i += bucketSize) {
      const slice = sorted.slice(i, i + bucketSize);
      const value = slice.reduce((s, r) => s + r.amount, 0);
      const t = new Date(slice[0].createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      historical.push({ t, value });
    }

    // Linear regression on historical values.
    const n = historical.length;
    const xs = historical.map((_, i) => i);
    const ys = historical.map((h) => h.value);
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;

    // Variance for confidence band.
    const residuals = ys.map((y, i) => y - (slope * i + intercept));
    const variance = residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2);
    const stdDev = Math.sqrt(variance);

    // Build combined series: historical (actual) + forecast.
    const series: ForecastPoint[] = historical.map((h, i) => ({
      t: h.t,
      actual: h.value,
      forecast: Math.max(0, slope * i + intercept),
      upper: null,
      lower: null,
      isForecast: false,
    }));

    // Forecast forward.
    let cumulativeProjected = 0;
    for (let i = 0; i < FORECAST_PERIODS; i++) {
      const idx = n + i;
      const forecastVal = Math.max(0, slope * idx + intercept);
      const upper = forecastVal + stdDev * 1.5;
      const lower = Math.max(0, forecastVal - stdDev * 1.5);
      cumulativeProjected += forecastVal;
      series.push({
        t: `+${i + 1}`,
        actual: null,
        forecast: forecastVal,
        upper,
        lower,
        isForecast: true,
      });
    }

    const projected = slope * (n + FORECAST_PERIODS - 1) + intercept;
    const lastActual = ys[ys.length - 1];
    const growthRate = lastActual > 0 ? ((projected - lastActual) / lastActual) * 100 : 0;
    const confidence = Math.max(20, Math.min(95, 100 - (stdDev / Math.max(1, yMean)) * 50));
    const totalProjected = cumulativeProjected;

    return { series, projected: Math.max(0, projected), growthRate, confidence, totalProjected };
  }, [revenueEvents]);

  const isPositiveGrowth = growthRate >= 0;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Revenue Forecast
          </h2>
          <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-300">
            predictive
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {revenueEvents.length} data points
        </span>
      </div>

      {/* Forecast KPI cards */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2.5 lg:grid-cols-4">
        <Kpi
          icon={ArrowUpRight}
          label="Projected Next"
          value={`$${compact(totalProjected)}`}
          sub={`${FORECAST_PERIODS} periods`}
          tone="text-violet-300"
        />
        <Kpi
          icon={isPositiveGrowth ? TrendingUp : TrendingDown}
          label="Growth Rate"
          value={`${isPositiveGrowth ? "+" : ""}${growthRate.toFixed(1)}%`}
          sub="trend slope"
          tone={isPositiveGrowth ? "text-emerald-300" : "text-rose-300"}
        />
        <Kpi
          icon={Sparkles}
          label="Confidence"
          value={`${confidence.toFixed(0)}%`}
          sub="model certainty"
          tone={confidence >= 70 ? "text-emerald-300" : confidence >= 40 ? "text-amber-300" : "text-rose-300"}
        />
        <Kpi
          icon={ArrowUpRight}
          label="Trajectory"
          value={isPositiveGrowth ? "Ascending" : "Declining"}
          sub={isPositiveGrowth ? "bullish" : "bearish"}
          tone={isPositiveGrowth ? "text-emerald-300" : "text-rose-300"}
        />
      </div>

      {/* Forecast chart */}
      <div className="p-3">
        {series.length < 4 ? (
          <div className="flex h-[200px] items-center justify-center font-mono text-[10px] text-muted-foreground">
            awaiting sufficient revenue data for forecast…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.75 0.16 150)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.75 0.16 150)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.7 0.18 300)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="oklch(0.7 0.18 300)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.7 0.18 300)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="oklch(0.7 0.18 300)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 8, fill: "oklch(0.64 0.012 250)" }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => `$${compact(v as number)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.235 0.016 250)",
                  border: "1px solid oklch(1 0 0 / 0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono)",
                }}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = { actual: "Actual", forecast: "Forecast", upper: "Upper", lower: "Lower" };
                  return [`$${compact(value)}`, labels[name] ?? name];
                }}
              />
              {/* Confidence band */}
              <Area type="monotone" dataKey="upper" stroke="none" fill="url(#bandGrad)" connectNulls={false} />
              <Area type="monotone" dataKey="lower" stroke="none" fill="oklch(0.16 0.012 250)" connectNulls={false} />
              {/* Forecast line */}
              <Area
                type="monotone"
                dataKey="forecast"
                stroke="oklch(0.7 0.18 300)"
                strokeWidth={2}
                strokeDasharray="5 3"
                fill="url(#forecastGrad)"
                connectNulls={false}
              />
              {/* Actual line */}
              <Area
                type="monotone"
                dataKey="actual"
                stroke="oklch(0.75 0.16 150)"
                strokeWidth={2.5}
                fill="url(#actualGrad)"
                connectNulls={false}
              />
              {/* Boundary line between actual + forecast */}
              <ReferenceLine x={series.find((s) => s.isForecast)?.t} stroke="oklch(1 0 0 / 0.15)" strokeDasharray="2 2" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-4 py-2 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-emerald-400" /> Actual revenue
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4 rounded-sm bg-violet-400" style={{ borderTop: "1px dashed" }} /> Forecast
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-violet-400/20" /> Confidence band
        </span>
        <span className="ml-auto text-muted-foreground/60">linear extrapolation · {FORECAST_PERIODS}pt horizon</span>
      </div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${tone}`} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}
