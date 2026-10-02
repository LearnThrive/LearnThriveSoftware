"use client";

import * as m from "framer-motion/m";
import { useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";
import {
  clamp01,
  curvePath,
  curveValue,
  loopNodes,
  MATHS_PLOT,
  plantScale,
  plotPoint,
  pointAlong,
  routePoints,
  tangentSegment,
  vertexFractions,
  windowed,
} from "@/lib/motion/subjectStage";
import styles from "./SubjectStage.module.css";

/**
 * The subject "worlds" at higher fidelity (plan15 Wave 9 section 13.1): one stage per subject, each its own
 * idea, related by the same frame, colour roles and calm.
 *
 *  - Maths: a coordinate plane. The curve draws as the section scrolls in, a marker follows it with its
 *    tangent and a coordinate label, and on a fine pointer the marker follows the cursor instead (smoothed).
 *  - English: a real sentence (public domain) being annotated: the repeated opening, then the contrast, with
 *    margin notes arriving in turn. Calm and typographic; the text is real and readable at rest.
 *  - Science: a loop of connected steps with a single signal travelling round it, lighting each step.
 *  - 11+: a route with four milestone flags that plant as the path reaches them.
 *
 * TIERS: scroll- and pointer-driven only on the full tier (`active`); every other tier, and reduced motion,
 * gets the finished picture, drawn and labelled, with nothing moving. At most one thing moves at a time, and
 * only while the visitor scrolls (nothing runs at rest). All colours are tokens (`--subject-accent`, `--fg-*`,
 * `--border-subtle`), so the stages follow the dark theme. The SVGs are decorative (`aria-hidden`); the English
 * sample is real text and stays in the accessibility tree.
 */
export type SubjectStageKind = "maths" | "english" | "science" | "11-plus";

export function SubjectStage({
  kind,
  progress,
  active,
}: {
  kind: SubjectStageKind;
  progress: MotionValue<number>;
  active: boolean;
}) {
  return (
    <div className={styles.stage} data-stage={kind} data-stage-active={active ? "true" : "false"}>
      {kind === "maths" ? <MathsStage progress={progress} active={active} /> : null}
      {kind === "english" ? <EnglishStage progress={progress} active={active} /> : null}
      {kind === "science" ? <ScienceStage progress={progress} active={active} /> : null}
      {kind === "11-plus" ? <RouteStage progress={progress} active={active} /> : null}
    </div>
  );
}

// ── Maths ──────────────────────────────────────────────────────────────────────────────────────────

const MATHS_REST = 0.62; // where the marker sits when nothing moves
const PLANE_W = 640;
const PLANE_H = 260;
const CURVE_D = curvePath();

function MathsStage({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const pointer = useMotionValue(-1);
  // Scroll drives it until the cursor is over the plane; then the cursor does, with a spring so it feels liquid.
  const target = useTransform([progress, pointer], ([scroll, cursor]: number[]) =>
    cursor >= 0 ? cursor : windowed(scroll, 0.05, 0.9),
  );
  const t = useSpring(target, { stiffness: 170, damping: 26, mass: 0.5 });

  const drawn = useTransform(t, (v) => (active ? v : 1));
  const at = useTransform(t, (v) => (active ? v : MATHS_REST));
  const mx = useTransform(at, (v) => plotPoint(v).x);
  const my = useTransform(at, (v) => plotPoint(v).y);
  const tx1 = useTransform(at, (v) => tangentSegment(v, 42).x1);
  const ty1 = useTransform(at, (v) => tangentSegment(v, 42).y1);
  const tx2 = useTransform(at, (v) => tangentSegment(v, 42).x2);
  const ty2 = useTransform(at, (v) => tangentSegment(v, 42).y2);
  // Below and to the right of the marker: the curve and its tangent run up and to the right, so that corner is free.
  const lx = useTransform(mx, (v) => Math.min(v + 14, MATHS_PLOT.x1 - 78));
  const ly = useTransform(my, (v) => Math.min(v + 30, MATHS_PLOT.yBottom - 8));
  const label = useTransform(at, (v) => `(${(v * 6).toFixed(1)}, ${(curveValue(v) * 6).toFixed(1)})`);

  const gridX = [0, 1, 2, 3, 4, 5, 6].map((i) => MATHS_PLOT.x0 + (i / 6) * (MATHS_PLOT.x1 - MATHS_PLOT.x0));
  const gridY = [0, 1, 2, 3, 4].map((i) => MATHS_PLOT.yBottom - (i / 4) * (MATHS_PLOT.yBottom - MATHS_PLOT.yTop));

  const fromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = rectRef.current ?? svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * PLANE_W;
    pointer.set(clamp01((x - MATHS_PLOT.x0) / (MATHS_PLOT.x1 - MATHS_PLOT.x0)));
  };

  return (
    <svg
      ref={svgRef}
      className={styles.plane}
      viewBox={`0 0 ${PLANE_W} ${PLANE_H}`}
      aria-hidden="true"
      focusable="false"
      // Fine pointer + active tier only: touch never gets a cursor-driven marker.
      onPointerEnter={(event) => {
        if (!active || event.pointerType !== "mouse") return;
        rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
      }}
      onPointerMove={(event) => {
        if (active && event.pointerType === "mouse") fromPointer(event);
      }}
      onPointerLeave={() => {
        rectRef.current = null;
        pointer.set(-1);
      }}
    >
      {gridX.map((x) => (
        <line key={`gx${x}`} x1={x} x2={x} y1={MATHS_PLOT.yTop} y2={MATHS_PLOT.yBottom} className={styles.grid} />
      ))}
      {gridY.map((y) => (
        <line key={`gy${y}`} x1={MATHS_PLOT.x0} x2={MATHS_PLOT.x1} y1={y} y2={y} className={styles.grid} />
      ))}
      <line x1={MATHS_PLOT.x0} x2={MATHS_PLOT.x1} y1={MATHS_PLOT.yBottom} y2={MATHS_PLOT.yBottom} className={styles.axis} />
      <line x1={MATHS_PLOT.x0} x2={MATHS_PLOT.x0} y1={MATHS_PLOT.yTop} y2={MATHS_PLOT.yBottom} className={styles.axis} />
      <path d={CURVE_D} className={styles.curveGhost} />
      <m.path d={CURVE_D} className={styles.curve} style={{ pathLength: drawn }} />
      <m.line x1={tx1} y1={ty1} x2={tx2} y2={ty2} className={styles.tangent} />
      <m.circle cx={mx} cy={my} r={6.5} className={styles.marker} />
      <m.text x={lx} y={ly} className={styles.pointLabel}>
        {label}
      </m.text>
    </svg>
  );
}

// ── English ────────────────────────────────────────────────────────────────────────────────────────

function Mark({ value, children, tone }: { value: MotionValue<number>; children: string; tone: "repeat" | "contrast" }) {
  return (
    <span className={styles.mark}>
      <m.i aria-hidden="true" className={`${styles.markFill} ${tone === "repeat" ? styles.markRepeat : styles.markContrast}`} style={{ scaleX: value }} />
      <span className={styles.markText}>{children}</span>
    </span>
  );
}

function EnglishStage({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const repeat = useTransform(progress, (v) => (active ? windowed(v, 0.08, 0.38) : 1));
  const contrast = useTransform(progress, (v) => (active ? windowed(v, 0.4, 0.7) : 1));
  const noteOneOpacity = useTransform(repeat, [0.4, 1], [0, 1]);
  const noteOneShift = useTransform(repeat, [0.4, 1], [10, 0]);
  const noteTwoOpacity = useTransform(contrast, [0.4, 1], [0, 1]);
  const noteTwoShift = useTransform(contrast, [0.4, 1], [10, 0]);

  return (
    <figure className={styles.sample}>
      <blockquote className={styles.quote}>
        <Mark value={repeat} tone="repeat">It was the</Mark> <Mark value={contrast} tone="contrast">best</Mark> of times,{" "}
        <Mark value={repeat} tone="repeat">it was the</Mark> <Mark value={contrast} tone="contrast">worst</Mark> of times
      </blockquote>
      <figcaption className={styles.cite}>Charles Dickens, A Tale of Two Cities (1859)</figcaption>
      <ul className={styles.notes}>
        <m.li style={{ opacity: noteOneOpacity, y: noteOneShift }}>
          <span className={`${styles.swatch} ${styles.markRepeat}`} aria-hidden="true" />
          <span>
            <strong>Repetition.</strong> The same opening twice sets up a rhythm to push against.
          </span>
        </m.li>
        <m.li style={{ opacity: noteTwoOpacity, y: noteTwoShift }}>
          <span className={`${styles.swatch} ${styles.markContrast}`} aria-hidden="true" />
          <span>
            <strong>Antithesis.</strong> Opposites placed side by side make the claim sharper.
          </span>
        </m.li>
      </ul>
    </figure>
  );
}

// ── Science ────────────────────────────────────────────────────────────────────────────────────────

const SCIENCE_STEPS = ["Observe", "Question", "Predict", "Test", "Explain"] as const;
const SCIENCE_NODES = loopNodes(SCIENCE_STEPS.length, 320, 128, 230, 82);
const SCIENCE_LOOP = [...SCIENCE_NODES, SCIENCE_NODES[0]];
const SCIENCE_FRACTIONS = vertexFractions(SCIENCE_LOOP);

function ScienceStage({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const lap = useTransform(progress, (v) => (active ? windowed(v, 0.1, 0.95) : 1));
  const sx = useTransform(lap, (v) => pointAlong(SCIENCE_LOOP, v).x);
  const sy = useTransform(lap, (v) => pointAlong(SCIENCE_LOOP, v).y);
  // The single travelling signal is only there while it travels.
  const signalOpacity = useTransform(lap, (v) => (active && v > 0 && v < 1 ? 1 : 0));

  return (
    <svg className={styles.plane} viewBox="0 0 640 256" aria-hidden="true" focusable="false">
      {SCIENCE_NODES.map((from, i) => {
        const to = SCIENCE_LOOP[i + 1];
        return <line key={`e${i}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} className={styles.edge} />;
      })}
      {SCIENCE_NODES.map((node, i) => (
        <ScienceNode key={SCIENCE_STEPS[i]} node={node} label={SCIENCE_STEPS[i]} at={SCIENCE_FRACTIONS[i]} lap={lap} active={active} />
      ))}
      <m.circle cx={sx} cy={sy} r={6} className={styles.signal} style={{ opacity: signalOpacity }} />
    </svg>
  );
}

function ScienceNode({
  node,
  label,
  at,
  lap,
  active,
}: {
  node: readonly [number, number];
  label: string;
  at: number;
  lap: MotionValue<number>;
  active: boolean;
}) {
  const lit = useTransform(lap, (v) => (active ? windowed(v, Math.max(0, at - 0.02), at + 0.03) : 1));
  const labelBelow = node[1] > 130;
  return (
    <g>
      <circle cx={node[0]} cy={node[1]} r={15} className={styles.nodeRing} />
      <m.circle cx={node[0]} cy={node[1]} r={15} className={styles.nodeFill} style={{ opacity: lit }} />
      <text x={node[0]} y={node[1] + (labelBelow ? 38 : -26)} textAnchor="middle" className={styles.nodeLabel}>
        {label}
      </text>
    </g>
  );
}

// ── 11+ ────────────────────────────────────────────────────────────────────────────────────────────

// Dense vertices, so the straight segments read as one smooth route and the travelling head stays on it.
const ROUTE = routePoints(640, 200, 33);
const ROUTE_D = ROUTE.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
const ROUTE_FRACTIONS = vertexFractions(ROUTE);
const FLAG_VERTICES = [8, 16, 24, 32] as const;

function RouteStage({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const drawn = useTransform(progress, (v) => (active ? windowed(v, 0.06, 0.92) : 1));
  const hx = useTransform(drawn, (v) => pointAlong(ROUTE, v).x);
  const hy = useTransform(drawn, (v) => pointAlong(ROUTE, v).y);
  const headOpacity = useTransform(drawn, (v) => (active && v > 0 && v < 1 ? 1 : 0));

  return (
    <svg className={styles.plane} viewBox="0 0 640 200" aria-hidden="true" focusable="false">
      <path d={ROUTE_D} className={styles.routeGhost} />
      <m.path d={ROUTE_D} className={styles.route} style={{ pathLength: drawn }} />
      {FLAG_VERTICES.map((vertex, i) => (
        <Flag key={vertex} x={ROUTE[vertex][0]} y={ROUTE[vertex][1]} at={ROUTE_FRACTIONS[vertex]} drawn={drawn} active={active} number={i + 1} />
      ))}
      <m.circle cx={hx} cy={hy} r={6} className={styles.signal} style={{ opacity: headOpacity }} />
    </svg>
  );
}

function Flag({
  x,
  y,
  at,
  drawn,
  active,
  number,
}: {
  x: number;
  y: number;
  at: number;
  drawn: MotionValue<number>;
  active: boolean;
  number: number;
}) {
  // The flag is "planted" by growing its pole and cloth from the base point. Done with attributes rather than
  // an SVG transform, so there is no transform-origin to get wrong and nothing to measure.
  const grow = useTransform(drawn, (v) => (active ? plantScale(v, at - 0.05, at + 0.07) : 1));
  const poleTop = useTransform(grow, (v) => -38 * v);
  const cloth = useTransform(grow, (v) => `M0 ${-38 * v} L${26 * v} ${-30 * v} L0 ${-22 * v} Z`);
  const baseRadius = useTransform(grow, (v) => 4.5 * Math.min(1, Math.max(0.35, v)));
  const numberOpacity = useTransform(grow, (v) => (v > 0.85 ? 1 : 0));
  return (
    <g transform={`translate(${x} ${y})`}>
      <m.line x1={0} y1={0} x2={0} y2={poleTop} className={styles.pole} />
      <m.path d={cloth} className={styles.flag} />
      <m.circle cx={0} cy={0} r={baseRadius} className={styles.flagBase} />
      <m.text x={9} y={-26} className={styles.flagNumber} style={{ opacity: numberOpacity }}>
        {number}
      </m.text>
    </g>
  );
}
