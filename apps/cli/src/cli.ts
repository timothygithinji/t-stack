#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  runMain,
  showUsage as defaultShowUsage,
} from "citty";
import { dirname, join } from "pathe";
import deployCommand from "./commands/deploy.js";
import destroyCommand from "./commands/destroy.js";
import doctorCommand from "./commands/doctor.js";
import initCommand from "./commands/init.js";
import loginCommand from "./commands/login.js";
import orgCommand from "./commands/org.js";
import provisionCommand from "./commands/provision.js";
import scaffoldCommand from "./commands/scaffold.js";
import secretsCommand from "./commands/secrets.js";

function readPkg(): { name?: string; version?: string } {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    try {
      const raw = readFileSync(join(dir, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "@timothygithinji/t-stack") {
        return pkg;
      }
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return {};
}

const pkg = readPkg();

const SUBCOMMAND_NAMES = [
  "init",
  "scaffold",
  "provision",
  "deploy",
  "destroy",
  "secrets",
  "doctor",
  "login",
  "org",
];

// Hand-curated grouping of subcommands for the top-level help. Ordered so
// the headline command (init) shows first and one-time setup ops sit at the
// bottom. Each command appears in exactly one group; flat fallback is the
// declaration order if a command is missing from the table.
const COMMAND_GROUPS: ReadonlyArray<{
  title: string;
  commands: ReadonlyArray<{ name: string; description: string }>;
}> = [
  {
    title: "Create",
    commands: [
      {
        name: "init",
        description: "Bootstrap a new project (scaffold + provision).",
      },
      {
        name: "scaffold",
        description: "Render templates only — no cloud calls.",
      },
      {
        name: "provision",
        description: "Run the preset against an existing project.",
      },
    ],
  },
  {
    title: "Operate",
    commands: [
      { name: "deploy", description: "Deploy app and/or infrastructure." },
      {
        name: "secrets",
        description: "Sync or pull secrets between Doppler and sinks.",
      },
      {
        name: "destroy",
        description: "Tear down all cloud resources for a project.",
      },
    ],
  },
  {
    title: "Inspect",
    commands: [
      {
        name: "doctor",
        description: "Verify CLI auth and cloud token health.",
      },
    ],
  },
  {
    title: "Setup",
    commands: [
      {
        name: "login",
        description: "Bootstrap meta tokens and Doppler config.",
      },
      {
        name: "org",
        description: "Manage org profiles in ~/.t-stack/orgs.toml.",
      },
    ],
  },
];

const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const underline = (s: string) => `\x1b[4m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

function renderGroupedTopLevelUsage(): string {
  const version = pkg.version ?? "0.0.0";
  const allCmds = COMMAND_GROUPS.flatMap((g) => g.commands.map((c) => c.name));
  const colWidth = Math.max(...allCmds.map((n) => n.length));

  const lines: string[] = [];
  lines.push(
    gray(
      `Personal project bootstrapper — scaffold, provision, deploy. (t-stack v${version})`
    ),
    ""
  );
  lines.push(
    `${underline(bold("USAGE"))} ${cyan("t-stack <command> [OPTIONS]")}`,
    ""
  );
  lines.push(underline(bold("COMMANDS")), "");
  for (const group of COMMAND_GROUPS) {
    lines.push(`  ${bold(group.title)}`);
    for (const c of group.commands) {
      lines.push(`    ${cyan(c.name.padEnd(colWidth))}    ${c.description}`);
    }
    lines.push("");
  }
  lines.push(
    `Use ${cyan("t-stack <command> --help")} for more information about a command.`
  );
  return lines.join("\n");
}

async function showUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>
): Promise<void> {
  // Only render the grouped layout for the top-level command. Subcommand
  // --help calls keep citty's default rendering since it handles their
  // OPTIONS / ARGUMENTS sections better than we would hand-roll.
  if ((cmd as unknown) === main) {
    console.log(`${renderGroupedTopLevelUsage()}\n`);
    return;
  }
  await defaultShowUsage(cmd, parent);
}

const main = defineCommand({
  meta: {
    name: "t-stack",
    version: pkg.version ?? "0.0.0",
    description: "Personal project bootstrapper — scaffold, provision, deploy.",
  },
  subCommands: {
    init: initCommand,
    scaffold: scaffoldCommand,
    provision: provisionCommand,
    deploy: deployCommand,
    destroy: destroyCommand,
    secrets: secretsCommand,
    doctor: doctorCommand,
    login: loginCommand,
    org: orgCommand,
  },
  async run() {
    // citty invokes `run` after subcommands too, so bail unless this is a
    // bare `t-stack` invocation. Without this guard, the usage + hint would
    // print after every successful subcommand.
    const firstArg = process.argv[2];
    if (firstArg && SUBCOMMAND_NAMES.includes(firstArg)) {
      return;
    }
    await showUsage(main);
    process.stderr.write(
      `\nQuick start: ${cyan("t-stack init <project-name>")}\n`
    );
    process.exit(0);
  },
});

runMain(main, { showUsage });
