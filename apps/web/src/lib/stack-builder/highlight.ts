// Use the core entry + explicit lang imports so Vite tree-shakes the
// hundreds of unused TextMate grammars. (`shiki`'s default barrel pulls
// every lang into the bundle.)
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

type Lang =
  | "typescript"
  | "tsx"
  | "javascript"
  | "json"
  | "jsonc"
  | "yaml"
  | "toml"
  | "markdown"
  | "bash";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/github-dark"),
        import("@shikijs/themes/github-light"),
      ],
      langs: [
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/jsonc"),
        import("@shikijs/langs/yaml"),
        import("@shikijs/langs/toml"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/bash"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return highlighterPromise;
}

const EXT_TO_LANG: Record<string, Lang> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
};

function langFromPath(path: string): Lang | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? null;
}

export interface HighlightToken {
  content: string;
  color: string | undefined;
}
export type HighlightLine = HighlightToken[];

/**
 * Tokenise `content` for the file's language and return per-line token
 * arrays. Caller renders the tokens via React (avoids injecting HTML).
 * Returns null when the extension doesn't map to a supported language —
 * caller should fall back to plain text.
 */
export async function highlightToTokens(
  path: string,
  content: string,
  theme: "dark" | "light" = "dark"
): Promise<HighlightLine[] | null> {
  const lang = langFromPath(path);
  if (!lang) {
    return null;
  }
  const highlighter = await getHighlighter();
  const result = highlighter.codeToTokens(content, {
    lang,
    theme: theme === "dark" ? "github-dark" : "github-light",
  });
  return result.tokens.map((line) =>
    line.map((t) => ({ content: t.content, color: t.color }))
  );
}
