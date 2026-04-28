"use client";

import { ThemeProvider } from "next-themes";
import { ActiveChatBroadcaster } from "@/components/notifications/active-chat-broadcaster";
import { NotificationListener } from "@/components/notifications/notification-listener";
import { useNotificationsChannel } from "@/lib/push/use-notifications-channel";
import { useRegisterServiceWorker } from "@/lib/push/use-sw-registration";
import { ToastStack } from "@/lib/use-toast";

function ServiceWorkerBoot(): null {
  // Side-effect only — registers the worker and tracks state in a
  // module-level store so settings UI can read it without a prop drill.
  useRegisterServiceWorker();
  return null;
}

function NotificationsChannel(): null {
  // Connects to /ws/notifications for cross-session in-app toasts.
  useNotificationsChannel();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ServiceWorkerBoot />
      <NotificationListener />
      <NotificationsChannel />
      <ActiveChatBroadcaster />
      {children}
      <ToastStack />
    </ThemeProvider>
  );
}
