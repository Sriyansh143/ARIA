"use client";
import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      toastOptions={{
        classNames: {
          toast: "bg-zinc-900 border-zinc-800 text-zinc-100",
        },
      }}
    />
  );
}
