"use client";
import { motion } from "framer-motion";

/**
 * LockSecure — Padlock — security
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface LockSecureProps {
  size?: number;
  className?: string;
}

export function LockSecure({ size = 200, className = "" }: LockSecureProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Padlock — security"
    >

    <motion.g
      animate={{ y: [0, -2, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <path d="M 70 90 L 70 70 C 70 50, 130 50, 130 70 L 130 90" fill="none" stroke="#f43f5e" strokeWidth="3"/>
      <rect x="50" y="90" width="100" height="80" rx="8" fill="url(#ls-grad)" stroke="#f43f5e" strokeWidth="2"/>
      <circle cx="100" cy="125" r="10" fill="#1e293b"/>
      <rect x="97" y="130" width="6" height="15" fill="#1e293b"/>
    </motion.g>
    <defs>
      <linearGradient id="ls-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fb7185" />
        <stop offset="100%" stopColor="#be123c" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

