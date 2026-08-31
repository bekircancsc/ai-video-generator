import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Argument parsing lives in src/services/cli-args.ts; this wrapper only forwards them.
const script = path.join(__dirname, "src", "pipeline", "render.ts");
const child = spawn(process.execPath, ["--import", "tsx", script, ...process.argv.slice(2)], {
  cwd: __dirname,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
