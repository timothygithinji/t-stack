import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";

// TanStack Start + Cloudflare Workers.
// - `cloudflare({ viteEnvironment: { name: "ssr" } })` reads `wrangler.jsonc`
//   as input, emits an output `wrangler.json` alongside the worker bundle,
//   and wires the SSR environment to Workers' runtime.
// - `tanstackStart()` provides the React Start framework integration (router,
//   server entry, file-based routes from `src/routes/`).
// - `react()` handles JSX + Fast Refresh in the client environment.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
  ],
});
