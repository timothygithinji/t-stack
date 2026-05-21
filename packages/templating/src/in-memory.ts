import Handlebars from "handlebars";
import { relative } from "pathe";

// Register helpers on the shared instance once. Mirrors the disk-based
// renderer in ./index.ts so the web preview and the CLI behave identically.
let helpersRegistered = false;
function ensureHelpers() {
  if (helpersRegistered) {
    return;
  }
  Handlebars.registerHelper("json", (value: unknown) => JSON.stringify(value));
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  helpersRegistered = true;
}

/** Render a Handlebars template against `vars`. */
export function renderString(
  template: string,
  vars: Record<string, unknown>
): string {
  ensureHelpers();
  return Handlebars.compile(template, { noEscape: true })(vars);
}

/**
 * Render a path fragment with Handlebars, then validate it. Empty / malformed
 * results signal "skip this file" (a templated path like `{{#if x}}foo{{/if}}`
 * collapses to "" when the condition is false).
 */
export function renderRelativePath(
  rel: string,
  vars: Record<string, unknown>
): string {
  const rendered = renderString(rel, vars).trim();
  if (!rendered) {
    return "";
  }
  if (rendered.endsWith("/") || rendered.startsWith("/")) {
    return "";
  }
  if (rendered.includes("//")) {
    return "";
  }
  return rendered;
}

export interface InMemoryFile {
  /** Absolute path within the source set (e.g. `solo-cf-worker/wrangler.jsonc`). */
  path: string;
  /** File contents as a UTF-8 string. Binary files are not supported in-memory. */
  content: string;
}

export interface RenderedFile {
  /** Final path after rendering Handlebars in path segments. */
  path: string;
  /** Final contents after rendering Handlebars in the body. */
  content: string;
  /** Original (un-rendered) path — useful for sources panels. */
  sourcePath: string;
}

/**
 * In-memory equivalent of `renderTemplate` from ./index.ts. Takes a list of
 * source files (e.g. produced by Vite's import.meta.glob) and renders each
 * one against `vars`, skipping files whose path renders empty.
 *
 * The web preview uses this; the CLI continues to use the disk-based path.
 */
export function renderInMemory(
  files: InMemoryFile[],
  rootPrefix: string,
  vars: Record<string, unknown>
): RenderedFile[] {
  const out: RenderedFile[] = [];
  for (const f of files) {
    if (!f.path.startsWith(rootPrefix)) {
      continue;
    }
    const rel = relative(rootPrefix, f.path);
    const renderedRel = renderRelativePath(rel, vars);
    if (!renderedRel) {
      continue;
    }
    out.push({
      path: renderedRel,
      sourcePath: rel,
      content: renderString(f.content, vars),
    });
  }
  return out;
}

/**
 * Overlay `over` on top of `base`, keyed by final path. Later overlays win.
 * Used to layer the archetype template on top of `_base/`.
 */
export function overlay(
  base: RenderedFile[],
  ...over: RenderedFile[][]
): RenderedFile[] {
  const map = new Map<string, RenderedFile>();
  for (const r of base) {
    map.set(r.path, r);
  }
  for (const layer of over) {
    for (const r of layer) {
      map.set(r.path, r);
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}
