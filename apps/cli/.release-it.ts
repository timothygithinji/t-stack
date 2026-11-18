/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${version} is release-it's runtime substitution syntax — must stay as a literal string, not a template literal */

import type { Config } from "release-it";

export default {
  git: {
    // Tags are the source of truth for versions. main is protected, so
    // release-it never commits back to it: the version bump in package.json
    // only lives in the CI workspace long enough to publish, and the tag
    // (pointing at the merged commit) plus the GitHub release record it.
    commit: false,
    tag: true,
    tagName: "v${version}",
    tagAnnotation: "Release v${version}",
    getLatestTagFromAllRefs: true,
    requireCleanWorkingDir: true,
    requireBranch: "main",
    push: true,
    pushRepo: "origin",
    pushArgs: ["--follow-tags"],
  },
  github: {
    release: true,
    releaseName: "Release v${version}",
    releaseNotes: null,
  },
  npm: {
    publish: true,
    // Read the current version from the latest git tag, not package.json
    // (which is pinned to 0.0.0-development in the repo).
    ignoreVersion: true,
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
      // No infile: notes go to the GitHub release only — no CHANGELOG.md.
    },
  },
} satisfies Config;
