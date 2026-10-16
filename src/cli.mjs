#!/usr/bin/env node

const command = process.argv[2];
await import(command === "reference" ? "./reference-cli.mjs" : command === "models" && ["help", "snapshot", "validate", "select", "replay", "pr-guard", "sync", "lint", "watch"].includes(process.argv[3]) ? "./lib/models-main.mjs" : "./cli-main.mjs");
// `nodekit models snapshot|validate|select|...` (the model registry) has its own small entry point; the older
// `nodekit models baseline|profile|inspect|diagnose` stay in cli-main. Routing here keeps cli-main untouched, and
// the import above stays on line 4 because tours and START_HERE cite it by line.
