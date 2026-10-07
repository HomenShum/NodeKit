// Import-graph rules for the kit's own source. Run: npx depcruise --validate src scripts
// Only two rules, because only two things have actually gone wrong here: a module
// that imports itself back through a chain (a cycle), and a module nothing reaches.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle means there is no order in which a reader can understand the two files.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "A module nothing imports is either dead or an undeclared entry point.",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.mts$", "\\.d\\.ts$", "^src/cli\\.mjs$", "^src/component/", "^scripts/"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules|_generated" },
    tsPreCompilationDeps: true,
  },
};
