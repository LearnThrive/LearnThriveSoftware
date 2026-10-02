import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 9 section 13.1: the geometry the subject worlds are driven by.

const g = loadTsFrom(import.meta.url, "../src/lib/motion/subjectStage.ts");

test("windowed maps a window onto 0..1 and clamps outside it", () => {
  assert.equal(g.windowed(0.5, 0.25, 0.75), 0.5);
  assert.equal(g.windowed(0, 0.25, 0.75), 0);
  assert.equal(g.windowed(1, 0.25, 0.75), 1);
  assert.equal(g.windowed(0.3, 0.5, 0.5), 0, "an empty window is a step");
  assert.equal(g.windowed(0.5, 0.5, 0.5), 1);
});

test("the maths curve stays inside the plot, starts low, ends high and always has a readable slope", () => {
  for (let i = 0; i <= 100; i += 1) {
    const v = g.curveValue(i / 100);
    assert.ok(v >= 0 && v <= 1, `curve out of range at ${i}`);
    const { x, y } = g.plotPoint(i / 100);
    assert.ok(x >= g.MATHS_PLOT.x0 && x <= g.MATHS_PLOT.x1);
    assert.ok(y >= g.MATHS_PLOT.yTop - 0.001 && y <= g.MATHS_PLOT.yBottom + 0.001);
  }
  assert.ok(g.curveValue(0) < 0.2);
  assert.ok(g.curveValue(1) > 0.8);
  assert.ok(g.curveValue(0.5) > 0.3 && g.curveValue(0.5) < 0.7);
});

test("the curve path is deterministic, fixed-decimal (so SSR and the client agree) and has one point per sample", () => {
  const a = g.curvePath();
  assert.equal(a, g.curvePath());
  assert.equal((a.match(/L/g) ?? []).length, 72);
  assert.match(a, /^M\d+\.\d \d+\.\d L/);
  assert.doesNotMatch(a, /NaN|Infinity/);
});

test("the tangent is a segment centred on the point, of the requested length, with the curve's slope", () => {
  for (const t of [0.1, 0.35, 0.6, 0.9]) {
    const p = g.plotPoint(t);
    const s = g.tangentSegment(t, 30);
    assert.ok(Math.abs((s.x1 + s.x2) / 2 - p.x) < 1e-9 && Math.abs((s.y1 + s.y2) / 2 - p.y) < 1e-9, "centred on the point");
    assert.ok(Math.abs(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) - 60) < 1e-6, "twice the half-length");
    // Screen slope of the segment equals the curve's screen slope.
    const screenSlope = (s.y2 - s.y1) / (s.x2 - s.x1);
    const expected = -g.curveSlope(t) * ((g.MATHS_PLOT.yBottom - g.MATHS_PLOT.yTop) / (g.MATHS_PLOT.x1 - g.MATHS_PLOT.x0));
    assert.ok(Math.abs(screenSlope - expected) < 1e-6);
  }
});

test("pointAlong walks a polyline by length: ends exactly at the vertices and never leaves it", () => {
  const line = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(g.pointAlong(line, 0), { x: 0, y: 0, segment: 0 });
  assert.deepEqual(g.pointAlong(line, 0.5), { x: 10, y: 0, segment: 0 });
  assert.deepEqual(g.pointAlong(line, 0.75), { x: 10, y: 5, segment: 1 });
  assert.deepEqual(g.pointAlong(line, 1), { x: 10, y: 10, segment: 1 });
  assert.deepEqual(g.pointAlong(line, 5), { x: 10, y: 10, segment: 1 }, "progress beyond 1 clamps");
  assert.deepEqual(g.pointAlong(line, -1), { x: 0, y: 0, segment: 0 });
  assert.deepEqual(g.pointAlong([], 0.5), { x: 0, y: 0, segment: 0 });
  assert.deepEqual(g.pointAlong([[3, 4]], 0.5), { x: 3, y: 4, segment: 0 });
});

test("vertexFractions says how far along each vertex sits", () => {
  assert.deepEqual(g.vertexFractions([[0, 0], [10, 0], [10, 10]]), [0, 0.5, 1]);
  assert.deepEqual(g.vertexFractions([[0, 0], [0, 0]]), [0, 0], "a zero-length line does not divide by zero");
});

test("loopNodes places n nodes around an ellipse, the first at the top, all distinct", () => {
  const nodes = g.loopNodes(5, 320, 130, 220, 90);
  assert.equal(nodes.length, 5);
  assert.deepEqual(nodes[0], [320, 40]);
  assert.equal(new Set(nodes.map((n) => n.join(","))).size, 5);
});

test("routePoints runs left to right inside its box", () => {
  const route = g.routePoints(640, 200);
  assert.equal(route.length, 9);
  for (let i = 1; i < route.length; i += 1) assert.ok(route[i][0] > route[i - 1][0], "x increases");
  for (const [x, y] of route) assert.ok(x >= 0 && x <= 640 && y >= 0 && y <= 200);
});

test("a planted flag grows from nothing, overshoots a little, and settles at exactly 1", () => {
  assert.equal(g.plantScale(0.1, 0.3, 0.5), 0);
  assert.equal(g.plantScale(0.9, 0.3, 0.5), 1);
  const samples = Array.from({ length: 21 }, (_, i) => g.plantScale(0.3 + (0.2 * i) / 20, 0.3, 0.5));
  assert.ok(Math.max(...samples) > 1 && Math.max(...samples) < 1.15, "a restrained overshoot");
  assert.ok(samples[0] === 0 && Math.abs(samples[20] - 1) < 1e-9);
});
