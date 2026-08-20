"use client";
import { motion } from "framer-motion";

/**
 * UptimeHeart — Heartbeat pulse — represents uptime + system health
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface UptimeHeartProps {
  size?: number;
  className?: string;
}

export function UptimeHeart({ size = 200, className = "" }: UptimeHeartProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Heartbeat pulse — represents uptime + system health"
    >

    <path d="M100 30 C 90 10, 60 10, 50 30 C 40 10, 10 10, 0 30 C 0 60, 50 90, 50 90 C 50 90, 100 60, 100 30 Z" fill="none" stroke="currentColor" strokeWidth="2" transform="translate(50,10)"/>
    <motion.path
      d="M 20 60 L 50 60 L 60 30 L 75 90 L 85 60 L 130 60"
      stroke="#10b981"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
    />
    
    </svg>
  );
}

