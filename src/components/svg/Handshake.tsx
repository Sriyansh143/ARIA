"use client";
import { motion } from "framer-motion";

/**
 * Handshake — Handshake — deal closed
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface HandshakeProps {
  size?: number;
  className?: string;
}

export function Handshake({ size = 200, className = "" }: HandshakeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Handshake — deal closed"
    >

    <motion.g
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <path d="M 30 90 L 70 70 L 100 90 L 130 70 L 170 90 L 170 110 L 130 130 L 100 110 L 70 130 L 30 110 Z"
        fill="url(#hs-grad)" stroke="#f59e0b" strokeWidth="1.5"/>
      <circle cx="50" cy="100" r="6" fill="#fbbf24"/>
      <circle cx="150" cy="100" r="6" fill="#fbbf24"/>
    </motion.g>
    <defs>
      <linearGradient id="hs-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fcd34d" />
        <stop offset="100%" stopColor="#b45309" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

