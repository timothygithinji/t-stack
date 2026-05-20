import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * TanStack Start router factory.
 *
 * The cloudflare-vite-plugin + tanstack-start integration imports this
 * via `@tanstack/react-start/server-entry` and instantiates a fresh
 * router per request on the worker side. The same factory is called by
 * the client entry during hydration.
 */
export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
