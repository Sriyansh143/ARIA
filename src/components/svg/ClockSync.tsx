"use client";
import { motion } from "framer-motion";

/**
 * ClockSync — Clock + sync arrows — scheduled jobs
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface ClockSyncProps {
  size?: number;
  className?: string;
}

export function ClockSync({ size = 200, className = "" }: ClockSyncProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Clock + sync arrows — scheduled jobs"
    >

    <motion.g
      animate={{ rotate: 360 }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      style={{ transformOrigin: "100px 100px" }}
    >
      <circle cx="100" cy="100" r="60" fill="none" stroke="#0ea5e9" strokeWidth="2"/>
      <line x1="100" y1="100" x2="100" y2="55" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round"/>
      <line x1="100" y1="100" x2="130" y2="115" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="100" cy="100" r="5" fill="#0ea5e9"/>
    </motion.g>
    <motion.path
      d="M 40 30 L 60 50 L 40 70"
      fill="none"
      stroke="#0ea5e9"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 1, repeat: Infinity }}
    />
    
    </svg>
  );
}

