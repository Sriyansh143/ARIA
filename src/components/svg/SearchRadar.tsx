"use client";
import { motion } from "framer-motion";

/**
 * SearchRadar — Radar sweep — represents lead discovery scanning
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface SearchRadarProps {
  size?: number;
  className?: string;
}

export function SearchRadar({ size = 200, className = "" }: SearchRadarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Radar sweep — represents lead discovery scanning"
    >

    <motion.g
      style={{ transformOrigin: "100px 100px" }}
      animate={{ rotate: 360 }}
      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
    >
      <defs>
        <linearGradient id="sr-sweep" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <path d="M 100 100 L 100 20 A 80 80 0 0 1 156 44 Z" fill="url(#sr-sweep)" />
    </motion.g>
    <circle cx="100" cy="100" r="30" fill="none" stroke="#06b6d4" strokeOpacity="0.4" strokeWidth="1.5"/>
    <circle cx="100" cy="100" r="50" fill="none" stroke="#06b6d4" strokeOpacity="0.3" strokeWidth="1.5"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="#06b6d4" strokeOpacity="0.2" strokeWidth="1.5"/>
    <circle cx="100" cy="100" r="4" fill="#06b6d4"/>
    
    </svg>
  );
}

