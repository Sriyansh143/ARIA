"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useInView, animate } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  duration = 1.5,
  format,
  prefix,
  suffix,
  decimals = 0,
  className,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration]);

  const text = format
    ? format(display)
    : display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return (
    <motion.span ref={ref} className={className}>
      {prefix}
      {text}
      {suffix}
    </motion.span>
  );
}
