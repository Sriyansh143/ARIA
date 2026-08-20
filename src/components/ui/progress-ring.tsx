"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
  showLabel?: boolean;
  label?: string;
  gradient?: string[];
  variant?: "default" | "success" | "warning" | "error";
}

const COLORS = {
  default: "#8b5cf6",
  success: "#10b981",
  warning: "#f59e0b",
  error: "#f43f5e",
};

export function ProgressRing({
  value,
  size = 60,
  strokeWidth = 4,
  className,
  showLabel = true,
  label,
  gradient,
  variant = "default",
}: ProgressRingProps) {
  const pct = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const strokeId = `pr-stroke-${gradient ? "g" : variant}`;
  const strokeRef = gradient ? `url(#${strokeId})` : COLORS[variant];

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          {gradient && (
            <linearGradient id={strokeId} x1="0%" y1="0%" x2="100%" y2="100%">
              {gradient.map((c, i) => (
                <stop key={i} offset={`${(i / (gradient.length - 1)) * 100}%`} stopColor={c} />
              ))}
            </linearGradient>
          )}
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-zinc-800"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeRef}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      {showLabel && (
        <span className="absolute text-[10px] font-mono font-semibold text-zinc-200">
          {label ?? `${pct.toFixed(0)}%`}
        </span>
      )}
    </div>
  );
}
