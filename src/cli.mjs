#!/usr/bin/env node

const command = process.argv[2];
await import(command === "reference" ? "./reference-cli.mjs" : "./cli-main.mjs");
