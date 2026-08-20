"use client";
import { forwardRef, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  gradient?: boolean;
  glow?: string | boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, hover = false, gradient = false, glow, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl",
        hover && "transition-all duration-300 hover:border-emerald-500/30 hover:bg-white/[0.04]",
        (gradient || !!glow) && "bg-gradient-to-br from-emerald-500/[0.04] via-teal-500/[0.02] to-cyan-500/[0.04]",
        glow === "emerald" && "shadow-[0_0_30px_-5px_rgba(16,185,129,0.25)]",
        className
      )}
      {...props}
    />
  )
);
GlassCard.displayName = "GlassCard";
