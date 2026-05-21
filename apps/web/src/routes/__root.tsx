import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "t-stack — stack builder" },
      {
        name: "description",
        content:
          "Build a t-stack init command. Pick an archetype, configure options, copy the command.",
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
