import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "artifacts/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
  {
    // apps/web/src/features/classroom is a direct port of the standalone apps/classroom app
    // (plan6.md section 5: "do not rewrite proven classroom logic unnecessarily — adapt it").
    // That app's own eslint config only enables react-hooks/rules-of-hooks and exhaustive-deps
    // (see apps/classroom/eslint.config.mjs); it was written and battle-tested against those
    // rules, with 26 unit + 40 Playwright tests riding on the exact timing/ref patterns below.
    // eslint-config-next's core-web-vitals preset additionally enables three newer React
    // Compiler advisory rules (purity/set-state-in-effect/refs) this project has never run the
    // actual compiler transform against — next.config.ts has no `experimental.reactCompiler`
    // flag, so these are lint-time-only advice, not a real runtime correctness risk today.
    // Rewriting every ticking-clock/throttled-ref pattern they flag (Timer, MicLevelMeter,
    // Whiteboard's throttled senders, the Help Queue's elapsed-time display) to satisfy them
    // would touch WebRTC/whiteboard-sync timing code with real regression risk, for a lint
    // preference this code was never meant to follow. rules-of-hooks/exhaustive-deps — the
    // rules this code was actually built and tested against — stay fully enforced.
    files: ["src/features/classroom/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
]);
