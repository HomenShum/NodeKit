// Entry point for the model-registry commands (see models-cli.mjs). Same output and exit conventions as
// cli-main: errors go to stderr as `nodekit: <message>` and set a non-zero exit code.
import { MODELS_SUBCOMMANDS, MODELS_USAGE, parseModelsArgs, runModelsCommand } from "./models-cli.mjs";

try {
  const parsed = parseModelsArgs(process.argv.slice(2));
  const sub = parsed.positional[1];
  if (sub === "help" || parsed.options.help) console.log(`Model registry (docs/MODEL_REGISTRY.md)\n\n${MODELS_USAGE}`);
  else if (MODELS_SUBCOMMANDS.includes(sub)) await runModelsCommand(sub, parsed);
  else throw new Error(`unknown models command: ${sub}`);
} catch (error) {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = error?.exitCode ?? 1;
}
