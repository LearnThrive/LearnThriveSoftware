# LearnThrive Tuition marketing website

A production-focused public marketing website for LearnThrive Tuition, built with Next.js, React and TypeScript.

## Local development

Use a supported Node.js version matching `package.json`, then run from `D:\LearnThrive`:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For a production preview, stop any existing server with Ctrl+C, then run:

```bash
npm run build
npm start
```

Open `http://localhost:3000` and hard-refresh with Ctrl+F5. `npm start` serves the
last production build, so rebuild and restart after changing source files. Use
`npm run dev` for live updates while editing; do not run both servers on port 3000.

## Quality checks

```bash
npm run check
```

This runs linting, TypeScript, content/link tests and a production build.

After a successful build, the responsive browser and accessibility checks can
be run with:

```bash
npm run test:browser
```

The browser check uses a locally installed Chrome or Edge executable and writes
review screenshots to `artifacts/browser`.

Run both the production checks and browser suite together with `npm run check:full`.

## Enquiries

The booking form prepares an email addressed to the published LearnThrive inbox; it does not claim to submit to a backend.

The FAQ page and homepage preview share `src/lib/faqs.ts`. Native accordions work
without JavaScript. Privacy, Cookies, Website Terms and Safeguarding pages describe
the current marketing and enquiry website. Outstanding company decisions and
the authoritative guidance consulted are recorded in `LEGAL_REVIEW.md`.

The old public tutor URLs permanently redirect to About. The separate external
Tutor login remains available in the footer.
