"use client";
import { motion } from "framer-motion";

/**
 * LeadFunnel — Inverted funnel — leads converting to customers
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface LeadFunnelProps {
  size?: number;
  className?: string;
}

export function LeadFunnel({ size = 200, className = "" }: LeadFunnelProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Inverted funnel — leads converting to customers"
    >

    <motion.path
      d="M 20 30 L 180 30 L 130 90 L 130 170 L 70 170 L 70 90 Z"
      fill="url(#lf-grad)"
      stroke="#06b6d4"
      strokeWidth="1.5"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 1.2, ease: "easeInOut" }}
    />
    <motion.circle
      cx="100" cy="50" r="4" fill="#fff"
      animate={{ y: [0, 110, 110], opacity: [1, 1, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeIn" }}
    />
    <motion.circle
      cx="80" cy="50" r="3" fill="#fff"
      animate={{ y: [0, 110, 110], opacity: [1, 1, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeIn", delay: 0.5 }}
    />
    <motion.circle
      cx="120" cy="50" r="3.5" fill="#fff"
      animate={{ y: [0, 110, 110], opacity: [1, 1, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeIn", delay: 1 }}
    />
    <defs>
      <linearGradient id="lf-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#0e7490" stopOpacity="0.6" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

