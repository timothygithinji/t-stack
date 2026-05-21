import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "t-stack:theme";

/**
 * Pre-hydration script: read the stored preference (or system pref) and
 * apply `.dark` to `<html>` before React mounts. Avoids the flash of
 * light theme during dark-mode loads. Embedded as an inline `<script>`
 * in __root.tsx so it runs synchronously on first paint.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`;

function readStored(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }
  const resolved = theme === "system" ? resolveSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

/**
 * Theme controller. Stores preference in localStorage; falls back to the
 * OS preference when set to "system". Listens for OS preference changes so
 * "system" mode tracks live.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const t = readStored();
    return t === "system" ? resolveSystemTheme() : t;
  });

  // Apply on mount + when theme changes.
  useEffect(() => {
    applyTheme(theme);
    setResolved(theme === "system" ? resolveSystemTheme() : theme);
  }, [theme]);

  // Track OS preference changes while in "system" mode.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyTheme("system");
      setResolved(resolveSystemTheme());
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (next: Theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    setThemeState(next);
  };

  return { theme, resolved, setTheme };
}
