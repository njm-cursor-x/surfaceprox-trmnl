// Entry for the bundled `slate` command (slate.mjs, the Docker image, and the SEA binary).
import { runCli } from "./cli.ts";

runCli(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
