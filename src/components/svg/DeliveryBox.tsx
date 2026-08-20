"use client";
import { motion } from "framer-motion";

/**
 * DeliveryBox — Box + checkmark — service delivery confirmation
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface DeliveryBoxProps {
  size?: number;
  className?: string;
}

export function DeliveryBox({ size = 200, className = "" }: DeliveryBoxProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Box + checkmark — service delivery confirmation"
    >

    <motion.g
      animate={{ rotate: [0, -5, 5, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformOrigin: "100px 80px" }}
    >
      <path d="M 60 50 L 100 35 L 140 50 L 100 65 Z" fill="url(#db-grad)" stroke="#22d3ee" strokeWidth="1.5"/>
      <path d="M 60 50 L 60 100 L 100 115 L 100 65 Z" fill="#0891b2"/>
      <path d="M 140 50 L 140 100 L 100 115 L 100 65 Z" fill="#06b6d4"/>
    </motion.g>
    <motion.circle
      cx="160"
      cy="40"
      r="20"
      fill="#10b981"
      animate={{ scale: [0, 1.2, 1] }}
      transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.5, ease: "easeOut" }}
    />
    <motion.path
      d="M 152 40 L 158 46 L 168 34"
      stroke="#fff"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ pathLength: [0, 1] }}
      transition={{ duration: 0.4, repeat: Infinity, repeatDelay: 1.7 }}
    />
    <defs>
      <linearGradient id="db-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#67e8f9" />
        <stop offset="100%" stopColor="#0891b2" />
      </linearGradient>
    </defs>
    
    </svg>
  );
}

