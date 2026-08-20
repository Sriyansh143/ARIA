"use client";
import { motion } from "framer-motion";

/**
 * GrowthChart — Bar chart rising — growth
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface GrowthChartProps {
  size?: number;
  className?: string;
}

export function GrowthChart({ size = 200, className = "" }: GrowthChartProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Bar chart rising — growth"
    >

    {[20, 50, 35, 80, 60, 110, 140].map((h, i) => (
      <motion.rect
        key={i}
        x={20 + i * 25}
        y={170 - h}
        width="18"
        height={h}
        rx="2"
        fill="url(#gc-grad)"
        initial={{ height: 0, y: 170 }}
        animate={{ height: h, y: 170 - h }}
        transition={{ duration: 0.6, delay: i * 0.1, ease: "easeOut" }}
      />
    ))}
    <motion.path
      d="M 28 150 L 53 120 L 78 135 L 103 90 L 128 110 L 153 60 L 178 30"
      stroke="#fbbf24"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 1.5, ease: "easeInOut" }}
    />
    <defs>
      <linearGradient id="gc-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#15803d" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

