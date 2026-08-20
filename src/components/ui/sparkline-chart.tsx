"use client";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  color?: string;
  fill?: string;
  className?: string;
}

export function SparklineChart({
  data,
  width = 120,
  height = 30,
  stroke,
  color,
  fill,
  className,
}: SparklineChartProps) {
  const strokeColor = stroke ?? color ?? "#10b981";
  const fillColor = fill ?? `${strokeColor}1a`;
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    return data
      .map((d, i) => {
        const x = i * stepX;
        const y = height - ((d - min) / range) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data, width, height]);

  const areaPath = path ? `${path} L${width},${height} L0,${height} Z` : "";

  return (
    <svg
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill={fillColor} />
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
