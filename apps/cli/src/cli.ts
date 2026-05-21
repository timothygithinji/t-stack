#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain, showUsage } from "citty";
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
      "\nQuick start: \x1b[36mt-stack init <project-name>\x1b[0m\n"
    );
    process.exit(0);
  },
});

runMain(main);
