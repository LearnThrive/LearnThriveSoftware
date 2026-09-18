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

function routeFile(route) {
  return route === "/"
    ? join(appDir, "page.tsx")
    : join(appDir, route.slice(1), "page.tsx");
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
    assert.ok(existsSync(routeFile(route)), `Missing page for ${route}`);
  }
});

test("navigation exposes the requested primary routes", () => {
  for (const route of navigationRoutes) {
    assert.match(siteSource, new RegExp(`href: [\"']${route.replace("/", "\\/")}[\"']`));
  }
});

test("removed tutor directory routes redirect permanently without public links", () => {
  assert.equal(existsSync(routeFile("/our-tutors")), false);
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
  assert.doesNotMatch(source, /TutorDirectory|window\.socket|cdn\.tutorcruncher\.com|\.tcs-/);
  assert.doesNotMatch(sitemapSource, /["']\/our-tutors["']/);
  assert.match(
    siteSource,
    /tutorLoginUrl:\s*"https:\/\/secure\.tutorcruncher\.com\/learnthrive-tuition\/login\/"/,
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
      if (!existsSync(routeFile(route))) {
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
  const budgets = new Map([
    ["public/brand/learnthrive-logo.png", 350_000],
    ["public/brand/learnthrive-mark.png", 175_000],
    ["public/images/online-tuition.webp", 100_000],
    ["public/og-image.png", 100_000],
  ]);

  for (const [path, limit] of budgets) {
    const fullPath = join(root, path);
    assert.ok(existsSync(fullPath), `Missing image: ${path}`);
    assert.ok(statSync(fullPath).size <= limit, `${path} exceeds ${limit} bytes`);
  }
});
