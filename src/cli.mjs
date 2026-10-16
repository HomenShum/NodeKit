#!/usr/bin/env node

const command = process.argv[2];
// `nodekit models snapshot|validate|select|...` (the model registry) has its own small entry point; the older
// `nodekit models baseline|profile|inspect|diagnose` stay in cli-main. Routing here keeps cli-main untouched.
const registryModels = command === "models" && ["help", "snapshot", "validate", "select", "replay", "pr-guard", "sync", "lint", "watch"].includes(process.argv[3]);
await import(command === "reference" ? "./reference-cli.mjs" : registryModels ? "./lib/models-main.mjs" : "./cli-main.mjs");
