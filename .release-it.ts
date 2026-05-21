/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${version} is release-it's runtime substitution syntax — must stay as a literal string, not a template literal */

import type { Config } from "release-it";

export default {
  git: {
    commitMessage: "chore: release v${version}",
    tagName: "v${version}",
    getLatestTagFromAllRefs: true,
    requireCleanWorkingDir: true,
    requireBranch: "main",
    push: true,
    pushRepo: "origin",
    // --no-verify: husky pre-push runs the full check on every push;
    // release-it has already validated the working tree, so skip the duplicate run.
    pushArgs: ["--no-verify", "--follow-tags"],
  },
  github: {
    release: true,
    releaseName: "Release v${version}",
    releaseNotes: null,
  },
  npm: {
    publish: true,
    // No NPM_TOKEN exists under trusted publishing — release-it's whoami
    // check would otherwise fail. `npm publish` itself succeeds via OIDC.
    skipChecks: true,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
        types: [
          { type: "feat", section: "Features" },
          { type: "fix", section: "Bug Fixes" },
          { type: "perf", section: "Performance" },
          { type: "refactor", section: "Refactoring" },
          { type: "docs", section: "Documentation" },
          { type: "test", section: "Tests" },
          { type: "build", section: "Build System" },
          { type: "ci", section: "CI/CD" },
          { type: "chore", section: "Maintenance" },
        ],
      },
      infile: "CHANGELOG.md",
      header: "# Changelog\n\n",
    },
  },
  hooks: {
    "before:init": ["bun run lint", "bun run typecheck", "bun run test"],
  },
} satisfies Config;
