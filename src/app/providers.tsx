"use client";

import { ThemeProvider } from "next-themes";
import { ActiveChatBroadcaster } from "@/components/notifications/active-chat-broadcaster";
import { NotificationListener } from "@/components/notifications/notification-listener";
import { useRegisterServiceWorker } from "@/lib/push/use-sw-registration";
import { ToastStack } from "@/lib/use-toast";

function ServiceWorkerBoot(): null {
  // Side-effect only — registers the worker and tracks state in a
  // module-level store so settings UI can read it without a prop drill.
  useRegisterServiceWorker();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ServiceWorkerBoot />
      <NotificationListener />
      <ActiveChatBroadcaster />
      {children}
      <ToastStack />
    </ThemeProvider>
  );
}
