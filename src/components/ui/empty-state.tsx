"use client";
import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center py-12 text-center", className)}
      {...props}
    >
      {icon && <div className="mb-3 text-zinc-700">{icon}</div>}
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description && <p className="mt-1 text-xs text-zinc-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
