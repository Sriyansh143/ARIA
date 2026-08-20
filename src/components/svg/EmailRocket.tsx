"use client";
import { motion } from "framer-motion";

/**
 * EmailRocket — Email rocket — outreach automation
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface EmailRocketProps {
  size?: number;
  className?: string;
}

export function EmailRocket({ size = 200, className = "" }: EmailRocketProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Email rocket — outreach automation"
    >

    <motion.g
      animate={{ y: [0, -8, 0], rotate: [0, -2, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <path d="M 30 80 L 80 30 L 100 50 L 50 100 Z" fill="url(#er-grad)" stroke="#8b5cf6" strokeWidth="1.5"/>
      <path d="M 30 80 L 50 100 L 40 90 Z" fill="#a78bfa"/>
      <circle cx="65" cy="65" r="6" fill="#1e293b"/>
      <defs>
        <linearGradient id="er-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </motion.g>
    <motion.path
      d="M 20 95 Q 25 90, 30 95 Q 35 100, 40 95"
      stroke="#fbbf24"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      animate={{ opacity: [0, 1, 0], scale: [0.8, 1, 0.8] }}
      transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
    />
    
    </svg>
  );
}

