// The production entry point (docs/DEPLOYMENT.md, "Production start path"): the unified server, in production mode, from any shell.
//
// `server.ts` serves the Next.js app AND the classroom's Socket.IO signalling and its TURN-credential endpoint on one origin, which is
// what the classroom's browser code expects (it calls io() and /api/turn-credentials on the site's own address). `next start` serves
// neither, so a deployment that needs the classroom must start through here. Next's own guide shows this pattern ("a custom server",
// node_modules/next/dist/docs/01-app/02-guides/custom-server.md).
//
// It sets NODE_ENV BEFORE anything is imported (so no module reads a stale value; `NODE_ENV=production cmd` does not work in a
// Windows shell, this does), registers tsx so the TypeScript source runs as it is, and then loads server.ts.
//
//   npm run build                       (once, in the same checkout)
//   npm run serve --workspace=apps/web  (PORT is read from the environment; Render sets it)
process.env.NODE_ENV = "production";

const { register } = await import("tsx/esm/api");
register();
await import("./server.ts");
