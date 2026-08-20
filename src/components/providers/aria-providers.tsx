"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";

/**
 * AriaProviders — composes theme + react-query + next-auth session.
 *
 * v33 theme fix: switched from `attribute="data-theme"` to `attribute="class"`
 * because Tailwind v4's `dark:` variant keys off the `.dark` class by default.
 * The previous `data-theme` attribute required custom CSS that didn't always
 * cascade to Shadcn/Radix components. Using `class` ensures `dark:` utilities
 * work everywhere + the CSS variables in globals.css (which target both
 * `.dark` and `:root[data-theme="dark"]`) still apply.
 *
 * Default theme: dark (mission-control is dark-first).
 */
export function AriaProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 2,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
