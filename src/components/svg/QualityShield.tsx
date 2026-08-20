"use client";
import { motion } from "framer-motion";

/**
 * QualityShield — Shield + checkmark — quality assurance
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface QualityShieldProps {
  size?: number;
  className?: string;
}

export function QualityShield({ size = 200, className = "" }: QualityShieldProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Shield + checkmark — quality assurance"
    >

    <motion.path
      d="M 100 20 L 30 50 L 30 110 C 30 140, 100 180, 100 180 C 100 180, 170 140, 170 110 L 170 50 Z"
      fill="url(#qs-grad)"
      stroke="#10b981"
      strokeWidth="2"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    />
    <motion.path
      d="M 70 100 L 92 122 L 135 78"
      stroke="#fff"
      strokeWidth="4"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
    />
    <defs>
      <linearGradient id="qs-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#047857" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

