// Dev entry (`pnpm dev`, tsx watch). The built binary's entry is cli.ts.
import { startServer } from "./start.ts";

await startServer({ dev: import.meta.url.endsWith(".ts") });
