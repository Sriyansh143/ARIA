"use client";
import { motion } from "framer-motion";

/**
 * AgentPulse — Pulse rings — agent activity
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface AgentPulseProps {
  size?: number;
  className?: string;
}

export function AgentPulse({ size = 200, className = "" }: AgentPulseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Pulse rings — agent activity"
    >

    <circle cx="100" cy="100" r="20" fill="#3b82f6"/>
    {[0,1,2].map(i => (
      <motion.circle
        key={i}
        cx="100"
        cy="100"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        initial={{ r: 20, opacity: 0.8 }}
        animate={{ r: 90, opacity: 0 }}
        transition={{ duration: 2, repeat: Infinity, delay: i * 0.66, ease: "easeOut" }}
      />
    ))}
    
    </svg>
  );
}

