import { useCallback, useEffect, useMemo, useState } from "react";
import { generateCommand } from "./command";
import { type DraftStack, DEFAULT_STACK } from "./types";
import { decodeStack, encodeStack } from "./url";

const LEADING_QUESTION_MARK = /^\?/;

interface UseStackBuilderResult {
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  applyPreset: (preset: DraftStack["archetype"]) => void;
  command: string;
  resetStack: () => void;
  copyCommand: () => Promise<void>;
  copied: boolean;
  shareUrl: string;
  copyShareUrl: () => Promise<void>;
  shareCopied: boolean;
}

/**
 * Holds the live stack-builder state. Two-way sync with `window.location.search`
 * so configs are shareable links — only fields that differ from defaults are
 * serialised, keeping the URL compact. Re-validates the command + share URL
 * on every change.
 */
export function useStackBuilder(): UseStackBuilderResult {
  const [stack, setStackState] = useState<DraftStack>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_STACK;
    }
    return decodeStack(
      window.location.search.replace(LEADING_QUESTION_MARK, "")
    );
  });
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Push state changes back to the URL without polluting history.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const search = encodeStack(stack);
    const url = search
      ? `${window.location.pathname}?${search}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [stack]);

  const setStack = useCallback((patch: Partial<DraftStack>) => {
    setStackState((prev) => {
      const next = { ...prev, ...patch };
      // Switching to mono forces neon — solo can pick either.
      if (next.archetype === "monorepo-cf") {
        next.database = "neon";
      }
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (preset: DraftStack["archetype"]) => {
      setStack({ archetype: preset });
    },
    [setStack]
  );

  const resetStack = useCallback(() => {
    setStackState(DEFAULT_STACK);
  }, []);

  const command = useMemo(() => generateCommand(stack), [stack]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const search = encodeStack(stack);
    const base = `${window.location.origin}${window.location.pathname}`;
    return search ? `${base}?${search}` : base;
  }, [stack]);

  const copyCommand = useCallback(async () => {
    if (typeof navigator === "undefined") {
      return;
    }
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  const copyShareUrl = useCallback(async () => {
    if (typeof navigator === "undefined" || !shareUrl) {
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  }, [shareUrl]);

  return {
    stack,
    setStack,
    applyPreset,
    command,
    resetStack,
    copyCommand,
    copied,
    shareUrl,
    copyShareUrl,
    shareCopied,
  };
}
