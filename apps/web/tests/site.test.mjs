import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const appDir = join(root, "src", "app");
const nextConfigSource = readFileSync(join(root, "next.config.ts"), "utf8");
const siteSource = readFileSync(join(root, "src", "lib", "site.ts"), "utf8");
const sitemapSource = readFileSync(join(appDir, "sitemap.ts"), "utf8");

const navigationRoutes = [
  "/",
  "/about",
  "/subjects",
  "/faq",
  "/book",
  "/contact",
];

const subjectLandingRoutes = [
  ["/maths-tuition", "Explore Maths Tuition"],
  ["/english-tuition", "Explore English Tuition"],
  ["/science-tuition", "Explore Science Tuition"],
  ["/11-plus-tuition", "Explore 11+ Preparation"],
];

const marketingRoutes = [
  ...navigationRoutes,
  ...subjectLandingRoutes.map(([route]) => route),
];

/** Every `page.tsx` under src/app, keyed by the URL path it actually serves.
 *
 * Route groups — `(public)`, `(app)`, `(auth)`, `(classroom)` — are organisational only: they
 * pick which shell wraps a page and never appear in the URL. A dynamic segment (`[id]`) matches
 * any single path segment. Both have to be accounted for here or this check would report every
 * real, working link as broken.
 */
function buildRouteMap(directory = appDir, urlSegments = []) {
  const routes = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      const nextSegments = isRouteGroup ? urlSegments : [...urlSegments, entry.name];
      for (const [route, file] of buildRouteMap(fullPath, nextSegments)) routes.set(route, file);
    } else if (entry.name === "page.tsx") {
      routes.set(`/${urlSegments.join("/")}`.replace(/\/$/, "") || "/", fullPath);
    }
  }
  return routes;
}

const routeMap = buildRouteMap();

function routeExists(route) {
  if (routeMap.has(route)) return true;
  // Fall back to matching a dynamic segment, e.g. /dashboard/lessons/abc -> /dashboard/lessons/[id].
  const wanted = route.split("/").filter(Boolean);
  return [...routeMap.keys()].some((candidate) => {
    const parts = candidate.split("/").filter(Boolean);
    if (parts.length !== wanted.length) return false;
    return parts.every((part, index) => (part.startsWith("[") && part.endsWith("]")) || part === wanted[index]);
  });
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

test("every primary marketing route has a page", () => {
  for (const route of marketingRoutes) {
    assert.ok(routeExists(route), `Missing page for ${route}`);
  }
});

test("navigation exposes the requested primary routes", () => {
  for (const route of navigationRoutes) {
    assert.match(siteSource, new RegExp(`href: [\"']${route.replace("/", "\\/")}[\"']`));
  }
});

test("removed tutor directory routes redirect permanently without public links", () => {
  assert.equal(routeExists("/our-tutors"), false);
  assert.equal(existsSync(join(root, "src", "components", "TutorDirectory.tsx")), false);

  for (const route of ["/our-tutors", "/ourTutors"]) {
    const escapedRoute = route.replace("/", "\\/");
    assert.match(
      nextConfigSource,
      new RegExp(
        `source:\\s*["']${escapedRoute}["'][\\s\\S]*?destination:\\s*["']\\/about["'][\\s\\S]*?permanent:\\s*true`,
      ),
    );
  }

  const source = sourceFiles(join(root, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /["'`]\/our(?:-tutors|Tutors)(?:["'`#?])/);
  assert.doesNotMatch(source, /TutorDirectory|window\.socket|cdn\.tutorcruncher\.com|secure\.tutorcruncher\.com|\.tcs-/);
  assert.doesNotMatch(sitemapSource, /["']\/our-tutors["']/);
  assert.match(
    siteSource,
    /tutorLoginUrl:\s*"\/login"/,
  );
});

test("subject landing paths and visible calls to action stay mapped together", () => {
  for (const [route, ctaLabel] of subjectLandingRoutes) {
    assert.ok(siteSource.includes(`path: "${route}"`), `Missing subject path: ${route}`);
    assert.ok(siteSource.includes(`ctaLabel: "${ctaLabel}"`), `Missing CTA: ${ctaLabel}`);
  }
  assert.match(sitemapSource, /subjects\.map\(\(subject\) => subject\.path\)/);
});

test("internal links resolve to a route or page anchor", () => {
  const missing = [];
  const hrefPattern = /href=(?:\{|)["'`]\/?([^"'`#?}]*)/g;

  for (const file of sourceFiles(join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(hrefPattern)) {
      const captured = match[1];
      if (!captured || captured.startsWith("mailto:") || captured.startsWith("tel:")) {
        continue;
      }
      const route = `/${captured}`.replace(/\/$/, "") || "/";
      if (route.includes("${") || route.startsWith("/http")) continue;
      if (!routeExists(route)) {
        missing.push(`${relative(root, file)} -> ${route}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("verified brand and contact details remain consistent", () => {
  assert.match(siteSource, /LearnThrive Tuition/);
  assert.match(siteSource, /Learn\. Grow\. Thrive\./);
  assert.match(siteSource, /info@learnthrivetuition\.co\.uk/);
  assert.match(
    siteSource,
    /name:\s*"Tahasin Hasan"[\s\S]*?phoneDisplay:\s*"\+44 7459 839595"[\s\S]*?phoneHref:\s*"\+447459839595"/,
  );
  assert.match(
    siteSource,
    /name:\s*"Abdurrahman Mustafa"[\s\S]*?phoneDisplay:\s*"\+44 7883 745337"[\s\S]*?phoneHref:\s*"\+447883745337"/,
  );
  assert.doesNotMatch(siteSource, /phoneDisplay:\s*"020 8059 1035"/);
  assert.doesNotMatch(siteSource, /phoneHref:\s*"\+442080591035"/);
});

test("required subjects and testimonial attributions are preserved", () => {
  for (const expected of [
    "Maths",
    "English",
    "Science",
    "11+ Preparation",
    "Mohammed M",
    "James H",
    "Aisha K",
    "Daniel P",
    "Emma R",
  ]) {
    assert.ok(siteSource.includes(expected), `Missing verified content: ${expected}`);
  }
});

test("production images exist and stay within their payload budgets", () => {
  // plan15 Wave 9/10: the 292 KB / 134 KB raster logos are now ~8 KB / ~2.5 KB vectors, and the four
  // subject photographs went from 1.2-3.8 MB originals to optimised masters (scripts/optimise-images.mjs).
  // Budgets only ever tighten.
  const budgets = new Map([
    ["public/brand/learnthrive-logo.svg", 12_000],
    ["public/brand/learnthrive-mark.svg", 6_000],
    ["public/brand/learnthrive-mark-light.svg", 6_000],
    ["public/icons/icon-512.png", 40_000],
    ["public/icons/maskable-512.png", 40_000],
    ["public/images/online-tuition.webp", 100_000],
    ["public/og-image.png", 100_000],
    ["public/images/subject-maths.jpg", 260_000],
    ["public/images/subject-english.jpg", 260_000],
    ["public/images/subject-science.jpg", 260_000],
    ["public/images/subject-elevenplus.jpg", 260_000],
    ["public/images/hero-tutor-student.jpg", 260_000],
  ]);

  for (const [path, limit] of budgets) {
    const fullPath = join(root, path);
    assert.ok(existsSync(fullPath), `Missing image: ${path}`);
    assert.ok(statSync(fullPath).size <= limit, `${path} exceeds ${limit} bytes`);
  }
});

// plan15 Wave 12: a page that exists but is missing from the sitemap is a page search engines are
// never told about; the closed-portal notice is the one public folder that must NOT be listed.
test("every public page folder is in the sitemap, and the portal notice is not", () => {
  const publicDir = join(appDir, "(public)");
  const folders = readdirSync(publicDir).filter((name) => statSync(join(publicDir, name)).isDirectory() && existsSync(join(publicDir, name, "page.tsx")));
  const subjectPaths = [...siteSource.matchAll(/path: "(\/[a-z0-9-]+)"/g)].map((m) => m[1]);
  const missing = folders
    .filter((name) => name !== "portal-opening-soon")
    .filter((name) => !sitemapSource.includes(`"/${name}"`) && !subjectPaths.includes(`/${name}`));
  assert.deepEqual(missing, [], `public pages missing from sitemap.ts: ${missing.join(", ")}`);
  assert.ok(folders.includes("portal-opening-soon"));
  assert.doesNotMatch(sitemapSource, /portal-opening-soon/);
});

test("robots.ts keeps crawlers out of the app, the API and development tools", () => {
  const robotsSource = readFileSync(join(appDir, "robots.ts"), "utf8");
  for (const path of ["/dashboard", "/api/", "/dev", "/login"]) {
    assert.ok(robotsSource.includes(`"${path}"`), `robots.ts should disallow ${path}`);
  }
});
