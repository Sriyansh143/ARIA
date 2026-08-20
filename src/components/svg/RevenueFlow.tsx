"use client";

import { motion } from "framer-motion";
import type { CSSProperties } from "react";

/**
 * RevenueFlow — coins flowing along a curved path.
 *
 * 3 coins travel along an S-curve path, representing money flowing
 * from customers → ARIA → delivered as revenue.
 *
 * Used in: Revenue page header, Overview "Revenue Today" KPI card background.
 *
 * Animation:
 *   - Path draws itself on mount (1.2s)
 *   - 3 coins flow along the path continuously (staggered, 2.5s loop each)
 *   - Coins have a subtle bob + glow
 */

interface RevenueFlowProps {
  size?: number;
  className?: string;
}

export function RevenueFlow({ size = 200, className = "" }: RevenueFlowProps) {
  // The S-curve path the coins follow. viewBox 0 0 200 120.
  const pathD = "M 10 60 C 50 20, 80 100, 120 60 S 190 20, 190 60";

  return (
    <svg
      width={size}
      height={size * 0.6}
      viewBox="0 0 200 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Revenue flowing"
    >
      <defs>
        <linearGradient id="rf-path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#34d399" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="rf-coin-grad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </radialGradient>
        <filter id="rf-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The path — draws itself on mount */}
      <motion.path
        d={pathD}
        stroke="url(#rf-path-grad)"
        strokeWidth={2}
        strokeDasharray="2 4"
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      />

      {/* 3 coins flowing along the path — staggered */}
      {[0, 0.83, 1.66].map((delay, i) => (
        <Coin key={i} pathD={pathD} delay={delay} />
      ))}

      {/* Start node (customer) */}
      <motion.circle
        cx={10}
        cy={60}
        r={5}
        fill="#6366f1"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
      />

      {/* End node (revenue) */}
      <motion.g
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
      >
        <circle cx={190} cy={60} r={6} fill="#10b981" filter="url(#rf-glow)" />
        <text x={190} y={63} textAnchor="middle" fontSize={7} fill="#0a0e0f" fontWeight="bold">
          $
        </text>
      </motion.g>
    </svg>
  );
}

/**
 * A single coin that flows along the path using offsetDistance.
 * Framer Motion animates offsetDistance from 0% to 100%.
 */
function Coin({ pathD, delay }: { pathD: string; delay: number }) {
  return (
    <motion.g
      style={{
        offsetPath: `path("${pathD}")`,
        offsetDistance: "0%",
      } as CSSProperties}
      animate={{
        offsetDistance: ["0%", "100%"],
      }}
      transition={{
        duration: 2.5,
        repeat: Infinity,
        ease: "linear",
        delay,
      }}
    >
      {/* The coin — golden circle with $ symbol + glow */}
      <motion.g
        animate={{
          y: [0, -3, 0], // subtle bob
        }}
        transition={{
          duration: 1,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <circle cx={0} cy={0} r={8} fill="url(#rf-coin-grad)" filter="url(#rf-glow)" stroke="#fbbf24" strokeWidth={0.5} />
        <text x={0} y={3} textAnchor="middle" fontSize={8} fill="#78350f" fontWeight="bold">
          $
        </text>
      </motion.g>
    </motion.g>
  );
}
