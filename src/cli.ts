#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
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

const main = defineCommand({
  meta: {
    name: pkg.name ?? "t-stack",
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
});

runMain(main);
