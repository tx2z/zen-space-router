// Configuration picked up automatically by `npx web-ext` (lint, build, sign, run).
export default {
  sourceDir: ".",
  artifactsDir: "web-ext-artifacts",
  ignoreFiles: [
    "probe",
    "probe/**",
    "CLAUDE.md",
    ".gitignore",
    "web-ext-config.mjs",
    "web-ext-artifacts/**",
    "test",
    "test/**",
    "package.json",
    ".github/**",
    "docs",
    "docs/**",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ],
  build: {
    overwriteDest: true,
  },
};
