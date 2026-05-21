import {
  Atom,
  Banknote,
  Blocks,
  Book,
  BookOpen,
  Boxes,
  Cable,
  Cloud,
  CloudOff,
  Code2,
  Cog,
  CreditCard,
  Database,
  Feather,
  FileCode,
  Flame,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Leaf,
  Lock,
  type LucideIcon,
  Network,
  Package,
  PackageOpen,
  Plug,
  Rocket,
  Route,
  Server,
  ServerCog,
  Settings2,
  Shield,
  Sparkles,
  SquareTerminal,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";

/**
 * Visual-selection category map. The web UI groups schema fields into these
 * sections, each rendered as a grid of clickable option cards. The set
 * mirrors the CLI's per-axis prompts: one card grid per enum field, plus
 * the project-text section and a final boolean toggle group.
 *
 * Multi-axis sections ("grouped" variant) bundle related axes under a
 * shared header — e.g. cloud provider + IaC + runtime sit under "Infra".
 */

export type CategoryKey =
  | "project"
  | "structure"
  | "infra"
  | "app"
  | "data"
  | "features"
  | "addons"
  | "tooling"
  | "toggles";

export interface SelectOption {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface GroupedField {
  field: string;
  title: string;
  options: SelectOption[];
}

export interface CategoryDef {
  key: CategoryKey;
  title: string;
  /**
   * - `input`     — free-text inputs (projectName / org / domain).
   * - `single`    — one enum field rendered as a single-select grid.
   * - `multiselect` — one array field rendered as a many-of-N grid.
   * - `grouped`   — multiple enum fields rendered as separate sub-blocks.
   * - `toggle-group` — many boolean fields rendered as cards.
   */
  variant: "input" | "single" | "multiselect" | "grouped" | "toggle-group";
  /** Used by `single` / `multiselect`: the schema field this section writes to. */
  field?: string;
  options?: SelectOption[];
  /** Used by `grouped`: ordered list of axes rendered side by side. */
  fields?: GroupedField[];
  /** Used by `toggle-group`: each card flips a different boolean field. */
  toggles?: Array<{
    field: string;
    label: string;
    description: string;
    icon: LucideIcon;
  }>;
  /** Hide the whole category when this shallow-equality predicate fails. */
  visibleIf?: Record<string, unknown>;
}

const structureOptions: SelectOption[] = [
  {
    value: "single",
    label: "Single app",
    description: "One repo, one app — fastest to ship.",
    icon: Zap,
  },
  {
    value: "monorepo",
    label: "Monorepo",
    description: "Workspaces + Turbo. Multi-app from day one.",
    icon: Boxes,
  },
];

const cloudProviderOptions: SelectOption[] = [
  {
    value: "cloudflare",
    label: "Cloudflare",
    description: "Workers + R2 + D1 + Access.",
    icon: Cloud,
  },
  {
    value: "none",
    label: "None",
    description: "Bring-your-own host. No provider-specific infra.",
    icon: CloudOff,
  },
];

const iacOptions: SelectOption[] = [
  {
    value: "pulumi",
    label: "Pulumi",
    description: "TypeScript-native IaC. Stateful & typed.",
    icon: Settings2,
  },
  {
    value: "none",
    label: "None",
    description: "Manual provisioning, no Pulumi stack.",
    icon: Cog,
  },
];

const runtimeOptions: SelectOption[] = [
  {
    value: "workers",
    label: "Cloudflare Workers",
    description: "Edge JS runtime. V8 isolates.",
    icon: Zap,
  },
  {
    value: "node",
    label: "Node.js",
    description: "Long-running Node server.",
    icon: Server,
  },
  {
    value: "bun",
    label: "Bun",
    description: "Bun's native HTTP server.",
    icon: Flame,
  },
  {
    value: "none",
    label: "None",
    description: "No server runtime (static / client-only).",
    icon: PackageOpen,
  },
];

const frontendOptions: SelectOption[] = [
  {
    value: "tanstack-start",
    label: "TanStack Start",
    description: "Full-stack TanStack framework w/ SSR.",
    icon: Sparkles,
  },
  {
    value: "tanstack-router",
    label: "TanStack Router",
    description: "Vite + TanStack Router SPA.",
    icon: Route,
  },
  {
    value: "astro",
    label: "Astro",
    description: "Content-first MPA with islands.",
    icon: Rocket,
  },
  {
    value: "none",
    label: "None",
    description: "No frontend (API only).",
    icon: PackageOpen,
  },
];

const backendOptions: SelectOption[] = [
  {
    value: "hono",
    label: "Hono",
    description: "Tiny edge-friendly HTTP framework.",
    icon: Flame,
  },
  {
    value: "tanstack-start",
    label: "TanStack Start",
    description: "Server routes from the frontend framework.",
    icon: Sparkles,
  },
  {
    value: "none",
    label: "None",
    description: "No backend layer.",
    icon: PackageOpen,
  },
];

const docsOptions: SelectOption[] = [
  {
    value: "starlight",
    label: "Starlight",
    description: "Astro docs site at apps/docs.",
    icon: BookOpen,
  },
  {
    value: "none",
    label: "None",
    description: "Skip the docs site.",
    icon: Book,
  },
];

const apiOptions: SelectOption[] = [
  {
    value: "orpc",
    label: "oRPC",
    description: "End-to-end typed RPC between client & server.",
    icon: Cable,
  },
  {
    value: "none",
    label: "None",
    description: "Plain HTTP, no shared client.",
    icon: Plug,
  },
];

const databaseOptions: SelectOption[] = [
  {
    value: "postgres",
    label: "Postgres",
    description: "Relational, mature, opinionated.",
    icon: Database,
  },
  {
    value: "sqlite",
    label: "SQLite",
    description: "Embedded SQL — fast & cheap.",
    icon: Layers,
  },
  {
    value: "none",
    label: "None",
    description: "No database.",
    icon: PackageOpen,
  },
];

const databaseHostOptions: SelectOption[] = [
  {
    value: "neon",
    label: "Neon",
    description: "Serverless Postgres, branchable.",
    icon: Leaf,
  },
  {
    value: "turso",
    label: "Turso",
    description: "Edge SQLite over libSQL.",
    icon: Globe,
  },
  {
    value: "d1",
    label: "Cloudflare D1",
    description: "Cloudflare's SQLite-on-Workers.",
    icon: Cloud,
  },
  {
    value: "none",
    label: "None",
    description: "Self-host or skip.",
    icon: PackageOpen,
  },
];

const ormOptions: SelectOption[] = [
  {
    value: "drizzle",
    label: "Drizzle",
    description: "TypeScript-first ORM, SQL-shaped.",
    icon: FileCode,
  },
  {
    value: "none",
    label: "None",
    description: "Raw queries / different ORM.",
    icon: PackageOpen,
  },
];

const authOptions: SelectOption[] = [
  {
    value: "better-auth",
    label: "Better Auth",
    description: "Drop-in auth with email + OAuth.",
    icon: KeyRound,
  },
  {
    value: "none",
    label: "None",
    description: "Bring your own auth.",
    icon: Lock,
  },
];

const storageOptions: SelectOption[] = [
  {
    value: "r2",
    label: "Cloudflare R2",
    description: "S3-compatible, no egress fees.",
    icon: HardDrive,
  },
  {
    value: "tigris",
    label: "Tigris",
    description: "S3-compatible global object store.",
    icon: Globe,
  },
  {
    value: "none",
    label: "None",
    description: "No object storage.",
    icon: PackageOpen,
  },
];

const paymentsOptions: SelectOption[] = [
  {
    value: "stripe",
    label: "Stripe",
    description: "Subscriptions + one-off charges.",
    icon: CreditCard,
  },
  {
    value: "none",
    label: "None",
    description: "No payments integration.",
    icon: Banknote,
  },
];

const addonOptions: SelectOption[] = [
  {
    value: "biome",
    label: "Biome",
    description: "Fast formatter + linter.",
    icon: Feather,
  },
  {
    value: "husky",
    label: "Husky",
    description: "Git hooks for pre-commit checks.",
    icon: GitBranch,
  },
  {
    value: "turborepo",
    label: "Turborepo",
    description: "Monorepo task runner & cache.",
    icon: Blocks,
  },
  {
    value: "fallow",
    label: "Fallow",
    description: "Mark stale work-in-progress.",
    icon: Leaf,
  },
  {
    value: "commitlint",
    label: "Commitlint",
    description: "Conventional Commits enforcement.",
    icon: SquareTerminal,
  },
  {
    value: "release-it",
    label: "release-it",
    description: "Automated changelogs + releases.",
    icon: Rocket,
  },
  {
    value: "ultracite",
    label: "Ultracite",
    description: "Stricter Biome preset.",
    icon: Atom,
  },
];

const packageManagerOptions: SelectOption[] = [
  {
    value: "bun",
    label: "Bun",
    description: "Fast all-in-one toolchain.",
    icon: Flame,
  },
  {
    value: "pnpm",
    label: "pnpm",
    description: "Disk-efficient package manager.",
    icon: Package,
  },
];

const envsOptions: SelectOption[] = [
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
];

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: "project",
    title: "Project",
    variant: "input",
  },
  {
    key: "structure",
    title: "Structure",
    variant: "single",
    field: "structure",
    options: structureOptions,
  },
  {
    key: "infra",
    title: "Infra",
    variant: "grouped",
    fields: [
      {
        field: "cloudProvider",
        title: "Cloud provider",
        options: cloudProviderOptions,
      },
      {
        field: "iac",
        title: "Infrastructure as code",
        options: iacOptions,
      },
      {
        field: "runtime",
        title: "Runtime",
        options: runtimeOptions,
      },
    ],
  },
  {
    key: "app",
    title: "App",
    variant: "grouped",
    fields: [
      {
        field: "frontend",
        title: "Frontend",
        options: frontendOptions,
      },
      {
        field: "backend",
        title: "Backend",
        options: backendOptions,
      },
      {
        field: "api",
        title: "API",
        options: apiOptions,
      },
      {
        field: "docs",
        title: "Docs site",
        options: docsOptions,
      },
    ],
  },
  {
    key: "data",
    title: "Data",
    variant: "grouped",
    fields: [
      {
        field: "database",
        title: "Database",
        options: databaseOptions,
      },
      {
        field: "databaseHost",
        title: "Database host",
        options: databaseHostOptions,
      },
      {
        field: "orm",
        title: "ORM",
        options: ormOptions,
      },
    ],
  },
  {
    key: "features",
    title: "Features",
    variant: "grouped",
    fields: [
      {
        field: "auth",
        title: "Auth",
        options: authOptions,
      },
      {
        field: "storage",
        title: "Object storage",
        options: storageOptions,
      },
      {
        field: "payments",
        title: "Payments",
        options: paymentsOptions,
      },
    ],
  },
  {
    key: "addons",
    title: "Add-ons",
    variant: "multiselect",
    field: "addons",
    options: addonOptions,
  },
  {
    key: "tooling",
    title: "Tooling",
    variant: "grouped",
    fields: [
      {
        field: "packageManager",
        title: "Package manager",
        options: packageManagerOptions,
      },
      {
        field: "envs",
        title: "Environments",
        options: envsOptions,
      },
    ],
  },
  {
    key: "toggles",
    title: "Toggles",
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
      {
        field: "git",
        label: "Initialise git",
        description: "Run `git init` after scaffolding.",
        icon: GitBranch,
      },
      {
        field: "install",
        label: "Install deps",
        description: "Run `bun install` after scaffolding.",
        icon: Code2,
      },
    ],
  },
];
