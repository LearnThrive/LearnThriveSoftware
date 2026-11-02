// The production entry point (docs/DEPLOYMENT.md, "Production start path"): the unified server, in production mode, from any shell.
//
// `server.ts` serves the Next.js app AND the classroom's Socket.IO signalling and its TURN-credential endpoint on one origin, which is
// what the classroom's browser code expects (it calls io() and /api/turn-credentials on the site's own address). `next start` serves
// neither, so a deployment that needs the classroom must start through here. Next's own guide shows this pattern ("a custom server",
// node_modules/next/dist/docs/01-app/02-guides/custom-server.md).
//
// It runs server.ts through tsx in a child process with NODE_ENV=production in its environment (`NODE_ENV=production cmd` does not
// work in a Windows shell, this does). A child process, with `node --import tsx` exactly as the repo's other TypeScript scripts run,
// because loading server.ts into THIS process through tsx's API fails on Node 22.12 (ERR_REQUIRE_CYCLE_MODULE): CI found it. Stop and
// terminate signals are passed on, so a deploy's SIGTERM reaches server.ts, which closes the sockets and exits.
//
//   npm run build                       (once, in the same checkout)
//   npm run serve --workspace=apps/web  (PORT is read from the environment; Render sets it)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(process.execPath, ["--import", "tsx", "server.ts", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error("Could not start the server:", error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
