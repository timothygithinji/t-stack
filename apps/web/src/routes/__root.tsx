import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  }),
  component: RootDocument,
});

function RootDocument(): ReactNode {
  return (
    <html lang="en">
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
