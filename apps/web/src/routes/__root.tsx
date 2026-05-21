import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "../styles.css";

// React Grab: dev-only UI element grabber for AI coding agents.
// The conditional import keeps it out of the production bundle entirely.
function useReactGrab() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      // biome-ignore lint/complexity/noVoid: fire-and-forget dynamic import
      void import("react-grab");
    }
  }, []);
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "t-stack — stack builder" },
      {
        name: "description",
        content:
          "Build a t-stack init command. Configure options, copy the command.",
      },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
    scripts: [
      // Synchronous pre-hydration script: sets `.dark` class on <html>
      // before React mounts so users in dark mode don't see a light flash.
      { children: THEME_INIT_SCRIPT },
    ],
  }),
  component: RootDocument,
});

function RootDocument(): ReactNode {
  useReactGrab();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
