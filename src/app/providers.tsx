"use client";

import { ThemeProvider } from "next-themes";
import { ToastStack } from "@/lib/use-toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
      <ToastStack />
    </ThemeProvider>
  );
}
