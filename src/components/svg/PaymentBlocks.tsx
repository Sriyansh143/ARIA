"use client";
import { motion } from "framer-motion";

/**
 * PaymentBlocks — Stacked coins — payment verification
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface PaymentBlocksProps {
  size?: number;
  className?: string;
}

export function PaymentBlocks({ size = 200, className = "" }: PaymentBlocksProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Stacked coins — payment verification"
    >

    <motion.g
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
    >
      <ellipse cx="100" cy="40" rx="50" ry="14" fill="url(#pb-grad)"/>
      <rect x="50" y="40" width="100" height="20" fill="url(#pb-grad)"/>
      <ellipse cx="100" cy="60" rx="50" ry="14" fill="#f59e0b"/>
    </motion.g>
    <motion.g
      animate={{ y: [0, -2, 0] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
    >
      <ellipse cx="100" cy="80" rx="50" ry="14" fill="#fbbf24"/>
      <rect x="50" y="80" width="100" height="20" fill="#f59e0b"/>
      <ellipse cx="100" cy="100" rx="50" ry="14" fill="#f59e0b"/>
    </motion.g>
    <defs>
      <linearGradient id="pb-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

