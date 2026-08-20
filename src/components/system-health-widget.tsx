/**
 * src/components/system-health-widget.tsx — v77.3
 *
 * System Health / Dependencies dashboard widget.
 * Shows real-time status indicators (Green/Yellow/Red) for:
 *   - Z-AI API / Web Search
 *   - Ollama Local LLM
 *   - Vector Memory (nomic-embed-text)
 *   - Telegram Bot
 *   - WhatsApp (Baileys)
 *   - Database
 *
 * Usage: <SystemHealthWidget /> on the dashboard overview or settings page.
 */

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface HealthStatus {
  zai: "healthy" | "degraded" | "down" | "checking";
  ollama: "healthy" | "degraded" | "down" | "checking";
  vectorMemory: "healthy" | "degraded" | "down" | "checking";
  telegram: "healthy" | "degraded" | "down" | "checking";
  whatsapp: "healthy" | "degraded" | "down" | "checking";
  database: "healthy" | "degraded" | "down" | "checking";
}

const initialStatus: HealthStatus = {
  zai: "checking",
  ollama: "checking",
  vectorMemory: "checking",
  telegram: "checking",
  whatsapp: "checking",
  database: "checking",
};

const statusConfig = {
  healthy: { icon: CheckCircle2, color: "text-emerald-500", badge: "bg-emerald-500", label: "Healthy" },
  degraded: { icon: AlertCircle, color: "text-amber-500", badge: "bg-amber-500", label: "Degraded" },
  down: { icon: XCircle, color: "text-red-500", badge: "bg-red-500", label: "Down" },
  checking: { icon: Loader2, color: "text-slate-400", badge: "bg-slate-400", label: "Checking..." },
};

export function SystemHealthWidget() {
  const [status, setStatus] = useState<HealthStatus>(initialStatus);
  const [loading, setLoading] = useState(true);

  const checkHealth = async () => {
    try {
      // Check all services in parallel
      const [zaiRes, ollamaRes, telegramRes, whatsappRes, dbRes] = await Promise.allSettled([
        fetch("/api/health/zai").then(r => r.json()),
        fetch("/api/health/ollama").then(r => r.json()),
        fetch("/api/health/telegram").then(r => r.json()),
        fetch("/api/health/whatsapp").then(r => r.json()),
        fetch("/api/health/database").then(r => r.json()),
      ]);

      const getStatus = (result: PromiseSettledResult<any>) => {
        if (result.status === "fulfilled" && result.value?.ok) return result.value.status || "healthy";
        return "down";
      };

      setStatus({
        zai: getStatus(zaiRes),
        ollama: getStatus(ollamaRes),
        vectorMemory: ollamaRes.status === "fulfilled" && ollamaRes.value?.models?.includes("nomic-embed-text") ? "healthy" : "degraded",
        telegram: getStatus(telegramRes),
        whatsapp: getStatus(whatsappRes),
        database: getStatus(dbRes),
      });
    } catch {
      // If the API endpoints don't exist yet, show degraded
      setStatus({
        zai: "degraded",
        ollama: "degraded",
        vectorMemory: "degraded",
        telegram: "degraded",
        whatsapp: "degraded",
        database: "healthy",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const services: Array<{ key: keyof HealthStatus; label: string; description: string }> = [
    { key: "zai", label: "Z-AI Web Search", description: "Lead generation + research pipeline" },
    { key: "ollama", label: "Ollama LLM", description: "Local AI model (llama3.2:3b)" },
    { key: "vectorMemory", label: "Vector Memory", description: "nomic-embed-text for semantic search" },
    { key: "telegram", label: "Telegram Bot", description: "Owner notifications + approvals" },
    { key: "whatsapp", label: "WhatsApp", description: "Baileys open-source messaging" },
    { key: "database", label: "Database", description: "SQLite/PostgreSQL via Prisma" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <SkeletonLoader lines={6} />
        ) : (
          <div className="space-y-3">
            {services.map((service) => {
              const s = status[service.key];
              const config = statusConfig[s];
              const Icon = config.icon;
              return (
                <div key={service.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${config.color} ${s === "checking" ? "animate-spin" : ""}`} />
                    <div>
                      <div className="text-sm font-medium">{service.label}</div>
                      <div className="text-xs text-muted-foreground">{service.description}</div>
                    </div>
                  </div>
                  <Badge className={`${config.badge} text-white text-xs`}>
                    {config.label}
                  </Badge>
                </div>
              );
            })}
            {/* Cron job alert banner */}
            <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-700">
                  <strong>Cron Job Status:</strong> If lead generation returns 0 results,
                  check Z-AI search status above. The app sends a Telegram notification
                  when search providers fail.
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


