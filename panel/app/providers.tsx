"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

/**
 * The panel is paper-native, so it defaults to LIGHT (the cold-paper Yggdrasil
 * theme) — the sidebar toggle flips to the navy dark theme. enableSystem is off
 * so an operator's OS preference doesn't silently change a prod ops console.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
