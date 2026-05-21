import {
  Boxes,
  Cloud,
  Database,
  Layers,
  type LucideIcon,
  Network,
  ServerCog,
  Shield,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";

/**
 * Visual-selection category map. The web UI groups schema fields into these
 * sections, each rendered as a grid of clickable option cards (better-t-stack
 * style). Free-text fields (projectName, org, domain) stay as inputs in the
 * top "Project" section.
 */

export type CategoryKey =
  | "project"
  | "archetype"
  | "database"
  | "envs"
  | "addons";

export interface SelectOption {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface CategoryDef {
  key: CategoryKey;
  title: string;
  /** Schema field this category writes to. Null for "project" (multi-field). */
  field: string | null;
  /** "single" = radio-style (one value); "toggle-group" = each card is its own boolean. */
  variant: "input" | "single" | "toggle-group";
  options?: SelectOption[];
  /** Toggle-group cards. Each card writes to a different boolean field. */
  toggles?: Array<{
    field: string;
    label: string;
    description: string;
    icon: LucideIcon;
  }>;
  /** Only show this category when the predicate matches the current stack. */
  visibleIf?: Record<string, unknown>;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: "project",
    title: "Project",
    field: null,
    variant: "input",
  },
  {
    key: "archetype",
    title: "Archetype",
    field: "archetype",
    variant: "single",
    options: [
      {
        value: "solo-cf-worker",
        label: "Solo CF Worker",
        description: "Single Vite + Cloudflare Workers app.",
        icon: Zap,
      },
      {
        value: "monorepo-cf",
        label: "Monorepo (Cloudflare)",
        description: "Bun workspaces + Turbo monorepo.",
        icon: Boxes,
      },
    ],
  },
  {
    key: "database",
    title: "Database",
    field: "database",
    variant: "single",
    visibleIf: { archetype: "solo-cf-worker" },
    options: [
      {
        value: "neon",
        label: "Neon",
        description: "Serverless Postgres, branchable.",
        icon: Database,
      },
      {
        value: "turso",
        label: "Turso",
        description: "Edge SQLite. Solo archetype only.",
        icon: Layers,
      },
    ],
  },
  {
    key: "envs",
    title: "Environments",
    field: "envs",
    variant: "single",
    options: [
      {
        value: "prd",
        label: "Production only",
        description: "Single environment, no staging.",
        icon: Cloud,
      },
      {
        value: "dev+prd",
        label: "Dev + Prod",
        description: "Two-env split, separate Doppler configs.",
        icon: Network,
      },
      {
        value: "dev+stg+prd",
        label: "Dev + Stage + Prod",
        description: "Three-env split with a staging tier.",
        icon: ServerCog,
      },
    ],
  },
  {
    key: "addons",
    title: "Add-ons",
    field: null,
    variant: "toggle-group",
    toggles: [
      {
        field: "trigger",
        label: "Trigger.dev",
        description: "Background jobs + scheduled tasks.",
        icon: Workflow,
      },
      {
        field: "access",
        label: "Cloudflare Access",
        description: "Protect the worker behind SSO / OTP.",
        icon: Shield,
      },
      {
        field: "hookdeck",
        label: "Hookdeck",
        description: "Inbound webhook ingest + retries.",
        icon: Webhook,
      },
    ],
  },
];
