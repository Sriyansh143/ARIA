"use client";
import { motion } from "framer-motion";

/**
 * BrainNetwork — Neural network nodes — multi-agent coordination
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface BrainNetworkProps {
  size?: number;
  className?: string;
}

export function BrainNetwork({ size = 200, className = "" }: BrainNetworkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Neural network nodes — multi-agent coordination"
    >

    {[{x:30,y:30},{x:100,y:30},{x:170,y:30},{x:65,y:100},{x:135,y:100},{x:100,y:170}].map((p, i) => (
      <motion.circle
        key={i}
        cx={p.x}
        cy={p.y}
        r="10"
        fill="#a855f7"
        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
      />
    ))}
    {[
      [30,30,100,30],[100,30,170,30],[30,30,65,100],[100,30,65,100],[100,30,135,100],
      [170,30,135,100],[65,100,135,100],[65,100,100,170],[135,100,100,170]
    ].map((line, i) => (
      <motion.line
        key={`l${i}`}
        x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]}
        stroke="#a855f7" strokeWidth="1" strokeOpacity="0.4"
        animate={{ strokeOpacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 2, repeat: Infinity, delay: i * 0.1 }}
      />
    ))}
    
    </svg>
  );
}

