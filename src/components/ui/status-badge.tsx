"use client";
import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "error" | "info" | "neutral" | "active" | "pending" | "idle";
type Size = "xs" | "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  default: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  error: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  info: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  neutral: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  idle: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

const SIZES: Record<Size, string> = {
  xs: "px-1.5 py-0.5 text-[10px]",
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  status?: Variant;
  size?: Size;
}

export function StatusBadge({
  variant = "default",
  status,
  size = "sm",
  className,
  ...props
}: StatusBadgeProps) {
  const v = status ?? variant;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-mono font-medium",
        VARIANTS[v] ?? VARIANTS.default,
        SIZES[size],
        className
      )}
      {...props}
    />
  );
}
