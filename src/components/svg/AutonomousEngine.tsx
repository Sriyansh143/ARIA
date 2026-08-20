"use client";
import { motion } from "framer-motion";

/**
 * AutonomousEngine — Spinning gears — autonomous operation
 *
 * Used in: ARIA dashboard panels + landing page section icons.
 */

interface AutonomousEngineProps {
  size?: number;
  className?: string;
}

export function AutonomousEngine({ size = 200, className = "" }: AutonomousEngineProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Spinning gears — autonomous operation"
    >

    <motion.g
      animate={{ rotate: 360 }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      style={{ transformOrigin: "70px 70px" }}
    >
      <Gear x={70} y={70} size={40} color="#8b5cf6" />
    </motion.g>
    <motion.g
      animate={{ rotate: -360 }}
      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      style={{ transformOrigin: "140px 130px" }}
    >
      <Gear x={140} y={130} size={28} color="#a855f7" />
    </motion.g>
    
    </svg>
  );
}

function Gear({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const teeth = 8;
  const outerR = size;
  const innerR = size * 0.75;
  const toothR = size * 1.15;
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? toothR : outerR;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const pathD = "M " + points.join(" L ") + " Z";
  return (
    <>
      <path d={pathD} fill={color} />
      <circle cx={x} cy={y} r={innerR * 0.5} fill="#0a0e0f" />
      <circle cx={x} cy={y} r={innerR * 0.3} fill={color} />
    </>
  );
}

