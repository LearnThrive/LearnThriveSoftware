"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useStateField } from "@openuidev/react-lang";
import { fitY, niceTicks, sampleCurve, tickLabel, type Point } from "@/lib/openui/graph";
import { parseMath } from "@/lib/openui/mathExpr";
import { asNumber, asStrings, partsOf, useHost } from "./host";
import { KatexMath, Rich } from "./Rich";
import styles from "./openui.module.css";

/**
 * The mathematics components. A graph is DRAWN FROM ITS FORMULA (lib/openui/graph.ts), so every point on it is a value the formula really has, and a
 * slider changes a number in the formula and the curve is recomputed in the browser: no coordinates a model wrote, no further request. A triangle is
 * drawn to scale from its sides and its angles are computed. A probability tree multiplies along its branches itself.
 */
type Render = { props: Record<string, unknown>; renderNode: (value: unknown) => ReactNode };
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const fmt = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(5))) : "undefined");
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

const PALETTE = [
  { stroke: "var(--fg-accent)", dash: undefined },
  { stroke: "#b45309", dash: "7 4" },
  { stroke: "#1d4ed8", dash: "2 4" },
  { stroke: "#7c3aed", dash: "10 3 2 3" },
] as const;

export function Equation({ props }: Render) {
  const caption = text(props.caption);
  return (
    <figure className={styles.equation}>
      <div className={styles.display} tabIndex={0} role="group" aria-label="Equation">
        <KatexMath tex={text(props.latex)} display />
      </div>
      {caption ? <figcaption><Rich text={caption} /></figcaption> : null}
    </figure>
  );
}

export function SolutionSteps({ props }: Render) {
  const steps = partsOf<{ say?: string; math?: string; hint?: string }>(props.steps);
  const title = text(props.title);
  const answer = text(props.answer);
  const [shown, setShown] = useState(0);
  const [hints, setHints] = useState<ReadonlySet<number>>(new Set());
  const { enabled } = useHost();
  const all = shown >= steps.length;
  return (
    <section className={styles.solution} aria-label={title || "Worked solution"}>
      {title ? <h5 className={styles.heading}><Rich text={title} /></h5> : null}
      <ol className={styles.solutionList}>
        {steps.slice(0, shown).map((s, i) => (
          <li key={i}>
            <p><Rich text={s.say} /></p>
            {s.math ? <div className={styles.display} tabIndex={0} role="group" aria-label={`Working for step ${i + 1}`}><KatexMath tex={s.math} display /></div> : null}
          </li>
        ))}
      </ol>
      {!all && steps[shown]?.hint ? (
        <div className={styles.hintRow}>
          <button type="button" className={styles.linkButton} aria-expanded={hints.has(shown)} onClick={() => setHints((h) => new Set(h).add(shown))} disabled={!enabled}>
            Hint for step {shown + 1}
          </button>
          {hints.has(shown) ? <span className={styles.hint}><Rich text={steps[shown]!.hint} /></span> : null}
        </div>
      ) : null}
      <div className={styles.row}>
        {!all ? (
          <>
            <button type="button" className={styles.primary} onClick={() => setShown((n) => n + 1)} disabled={!enabled}>{shown === 0 ? "Show the first step" : "Show the next step"}</button>
            <button type="button" className={styles.secondary} onClick={() => setShown(steps.length)} disabled={!enabled}>Show all steps</button>
          </>
        ) : (
          <button type="button" className={styles.secondary} onClick={() => { setShown(0); setHints(new Set()); }} disabled={!enabled}>Hide the steps and try again</button>
        )}
        <span className={styles.count} role="status">{shown} of {steps.length} steps shown</span>
      </div>
      {all && answer ? <p className={styles.answerLine}><strong>Answer: </strong><Rich text={answer} /></p> : null}
    </section>
  );
}

export function Slider({ props }: Render) {
  const name = text(props.name) || "value";
  const min = asNumber(props.min, 0);
  const max = asNumber(props.max, 10);
  const step = asNumber(props.step, (max - min) / 100) || 0.1;
  const field = useStateField<number>(name, props.value as number | undefined);
  const [local, setLocal] = useState(min);
  const { enabled } = useHost();
  const id = useId();
  const raw = field.isReactive ? Number(field.value) : local;
  const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min;
  const change = (v: number) => (field.isReactive ? field.setValue(v) : setLocal(v));
  return (
    <div className={styles.slider}>
      <label htmlFor={id}><Rich text={props.label} /></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={!enabled} aria-valuetext={`${text(props.label)}: ${fmt(value)}`} onChange={(e) => change(Number(e.target.value))} />
      <output htmlFor={id} className={styles.sliderValue}>{fmt(value)}</output>
    </div>
  );
}

interface Curve {
  label: string;
  expression: string;
  segments: Point[][];
  range: [number, number] | null;
  values: Array<[number, number]>;
}

export function FunctionGraph({ props }: Render) {
  const { canAsk, ask } = useHost();
  const uid = cleanId(useId());
  const fns = partsOf<{ expression?: string; label?: string }>(props.functions);
  const params = partsOf<{ name?: string; value?: unknown }>(props.params);
  const points = partsOf<{ x?: number; y?: number; label?: string }>(props.points);
  const title = text(props.title);
  const xMin = asNumber(props.xMin, -5);
  const xMax = asNumber(props.xMax, 5);
  const yGiven = props.yMin !== undefined && props.yMin !== null && props.yMax !== undefined && props.yMax !== null;
  const scope = Object.fromEntries(params.map((p) => [text(p.name), asNumber(p.value, 1)]));
  const scopeKey = JSON.stringify(scope);
  const names = params.map((p) => text(p.name));

  const { curves, yWin } = useMemo(() => {
    const parsed = fns.map((f) => ({ f, tree: parseMath(text(f.expression), ["x", ...names]) }));
    const all: number[] = [];
    const rough = parsed.map(({ f, tree }): Curve => {
      if (!tree.ok) return { label: text(f.label) || text(f.expression), expression: text(f.expression), segments: [], range: null, values: [] };
      const s = JSON.parse(scopeKey) as Record<string, number>;
      const c = sampleCurve(tree.tree, s, xMin, xMax, 240);
      for (const seg of c.segments) for (const [, y] of seg) all.push(y);
      return { label: text(f.label) || text(f.expression), expression: text(f.expression), segments: c.segments, range: c.range, values: [] };
    });
    const win: [number, number] = yGiven ? [asNumber(props.yMin), asNumber(props.yMax)] : fitY(rough.map((c) => c.range), all);
    // Drawn again against the final window, so a vertical asymptote breaks the line instead of striking across the plot.
    const final = parsed.map(({ f, tree }, i): Curve => {
      if (!tree.ok) return rough[i]!;
      const s = JSON.parse(scopeKey) as Record<string, number>;
      const c = sampleCurve(tree.tree, s, xMin, xMax, 400, win);
      const values: Array<[number, number]> = Array.from({ length: 9 }, (_, k) => {
        const x = xMin + ((xMax - xMin) * k) / 8;
        return [x, sampleCurve(tree.tree, s, x, x, 2).range?.[0] ?? Number.NaN];
      });
      return { label: text(f.label) || text(f.expression), expression: text(f.expression), segments: c.segments, range: c.range, values };
    });
    return { curves: final, yWin: win };
    // The formulas and window are fixed once the interface is checked; only the parameters change as a slider moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, xMin, xMax, yGiven, props.yMin, props.yMax, props.functions]);

  const W = 640;
  const H = 400;
  const m = { l: 48, r: 16, t: 14, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const sx = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * pw;
  const sy = (y: number) => m.t + (1 - (y - yWin[0]) / (yWin[1] - yWin[0])) * ph;
  const xt = niceTicks(xMin, xMax, 8);
  const yt = niceTicks(yWin[0], yWin[1], 6);
  const summary = `Graph${title ? ` of ${title}` : ""}: ${curves.map((c) => c.label).join("; ")}, for x from ${fmt(xMin)} to ${fmt(xMax)}.`;
  return (
    <figure className={styles.graph}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className={styles.svg}>
        <defs>
          <clipPath id={`${uid}-clip`}>
            <rect x={m.l} y={m.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        <rect x={m.l} y={m.t} width={pw} height={ph} className={styles.plotArea} />
        {xt.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={m.t + ph} className={t === 0 ? styles.axis : styles.grid} />
            <text x={sx(t)} y={H - 12} textAnchor="middle" className={styles.tick}>{tickLabel(t)}</text>
          </g>
        ))}
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={m.l} x2={m.l + pw} y1={sy(t)} y2={sy(t)} className={t === 0 ? styles.axis : styles.grid} />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className={styles.tick}>{tickLabel(t)}</text>
          </g>
        ))}
        <g clipPath={`url(#${uid}-clip)`}>
          {curves.map((c, i) =>
            c.segments.map((seg, k) => (
              <polyline key={`${i}-${k}`} points={seg.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")} fill="none" stroke={PALETTE[i % PALETTE.length]!.stroke} strokeWidth={2.4} strokeDasharray={PALETTE[i % PALETTE.length]!.dash} strokeLinejoin="round" />
            )),
          )}
        </g>
        {points.map((p, i) => {
          const x = asNumber(p.x);
          const y = asNumber(p.y);
          if (x < xMin || x > xMax || y < yWin[0] || y > yWin[1]) return null;
          return (
            <g key={i}>
              <circle cx={sx(x)} cy={sy(y)} r={4.5} className={styles.point} />
              {p.label ? <text x={sx(x) + 8} y={sy(y) - 8} className={styles.pointLabel}>{p.label}</text> : null}
            </g>
          );
        })}
      </svg>
      <ul className={styles.legend}>
        {curves.map((c, i) => (
          <li key={i}>
            <svg width="30" height="10" aria-hidden="true"><line x1="0" x2="30" y1="5" y2="5" stroke={PALETTE[i % PALETTE.length]!.stroke} strokeWidth="2.4" strokeDasharray={PALETTE[i % PALETTE.length]!.dash} /></svg>
            <span>{c.label}</span>
            {!c.segments.length ? <em> (not defined in this window)</em> : null}
          </li>
        ))}
        {params.map((p) => (
          <li key={text(p.name)} className={styles.paramValue}>{text(p.name)} = {fmt(asNumber(p.value, 1))}</li>
        ))}
      </ul>
      <details className={styles.dataDetails}>
        <summary>Show the values as a table</summary>
        <div className={styles.scroll} tabIndex={0} role="group" aria-label="Values of the graph">
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">x</th>{curves.map((c, i) => <th key={i} scope="col">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {curves[0]?.values.map(([x], r) => (
                <tr key={r}><th scope="row">{fmt(x)}</th>{curves.map((c, i) => <td key={i}>{fmt(c.values[r]?.[1] ?? Number.NaN)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <button type="button" className={styles.linkButton} disabled={!canAsk} onClick={() => ask(`Can you explain this graph: ${curves.map((c) => c.expression).join(" and ")}${params.length ? ` (with ${params.map((p) => `${text(p.name)} = ${fmt(asNumber(p.value, 1))}`).join(", ")})` : ""}?`)}>
        Explain this graph
      </button>
    </figure>
  );
}

export function NumberLine({ props }: Render) {
  const min = asNumber(props.min, 0);
  const max = asNumber(props.max, 10);
  const marks = Array.isArray(props.marks) ? (props.marks as unknown[]).map((v) => asNumber(v)) : [];
  const step = asNumber(props.step, 0);
  const title = text(props.title);
  const ticks = step > 0 && (max - min) / step <= 40 ? Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => Number((min + i * step).toPrecision(12))) : niceTicks(min, max, 10);
  const W = 640;
  const x = (v: number) => 24 + ((v - min) / (max - min)) * (W - 48);
  return (
    <figure className={styles.numberLine}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <svg viewBox={`0 0 ${W} 80`} role="img" aria-label={`Number line from ${fmt(min)} to ${fmt(max)} with ${marks.length ? marks.map(fmt).join(", ") : "nothing"} marked`} className={styles.svg}>
        <line x1={x(min)} x2={x(max)} y1={44} y2={44} className={styles.axis} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={38} y2={50} className={styles.axis} />
            <text x={x(t)} y={68} textAnchor="middle" className={styles.tick}>{tickLabel(t)}</text>
          </g>
        ))}
        {marks.map((v, i) => (
          <g key={i}>
            <circle cx={x(v)} cy={44} r={6} className={styles.point} />
            <text x={x(v)} y={26} textAnchor="middle" className={styles.pointLabel}>{fmt(v)}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function Triangle({ props }: Render) {
  const a = asNumber(props.a, 3);
  const b = asNumber(props.b, 4);
  const c = asNumber(props.c, 5);
  const title = text(props.title);
  // C along the base, A at the origin: the third vertex from the law of cosines. The angles are computed, never written.
  const cosA = (b * b + c * c - a * a) / (2 * b * c);
  const cosB = (a * a + c * c - b * b) / (2 * a * c);
  const A = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
  const B = (Math.acos(Math.max(-1, Math.min(1, cosB))) * 180) / Math.PI;
  const C = 180 - A - B;
  const apex = { x: b * cosA, y: b * Math.sin((A * Math.PI) / 180) };
  const scale = Math.min(440 / Math.max(c, apex.x, 1), 190 / Math.max(apex.y, 1));
  const px = (v: number) => 90 + v * scale;
  const py = (v: number) => 230 - v * scale;
  const pts = { A: [px(0), py(0)], B: [px(c), py(0)], C: [px(apex.x), py(apex.y)] } as const;
  const mid = (p: readonly number[], q: readonly number[]) => [(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2] as const;
  return (
    <figure className={styles.triangle}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <svg viewBox="0 0 640 260" role="img" aria-label={`Triangle with sides ${fmt(a)}, ${fmt(b)} and ${fmt(c)}; angles ${fmt(A)}, ${fmt(B)} and ${fmt(C)} degrees`} className={styles.svg}>
        <polygon points={`${pts.A.join(",")} ${pts.B.join(",")} ${pts.C.join(",")}`} className={styles.shape} />
        <text x={mid(pts.B, pts.C)[0]! + 10} y={mid(pts.B, pts.C)[1]!} className={styles.pointLabel}>a = {fmt(a)}</text>
        <text x={mid(pts.A, pts.C)[0]! - 10} y={mid(pts.A, pts.C)[1]!} textAnchor="end" className={styles.pointLabel}>b = {fmt(b)}</text>
        <text x={mid(pts.A, pts.B)[0]!} y={pts.A[1] + 22} textAnchor="middle" className={styles.pointLabel}>c = {fmt(c)}</text>
        <text x={pts.A[0] + 16} y={pts.A[1] - 8} className={styles.tick}>A {fmt(A)}°</text>
        <text x={pts.B[0] - 16} y={pts.B[1] - 8} textAnchor="end" className={styles.tick}>B {fmt(B)}°</text>
        <text x={pts.C[0]} y={pts.C[1] - 10} textAnchor="middle" className={styles.tick}>C {fmt(C)}°</text>
      </svg>
      <p className={styles.count}>Angles are worked out from the three sides: A {fmt(A)}°, B {fmt(B)}°, C {fmt(C)}°.</p>
    </figure>
  );
}

export function DataChart({ props }: Render) {
  const { canAsk, ask } = useHost();
  const kind = props.kind === "line" || props.kind === "scatter" ? props.kind : "bar";
  const labels = asStrings(props.labels);
  const series = partsOf<{ name?: string; values?: unknown }>(props.series).map((s) => ({ name: text(s.name), values: Array.isArray(s.values) ? (s.values as unknown[]).map((v) => asNumber(v)) : [] }));
  const title = text(props.title);
  const xLabel = text(props.xLabel);
  const yLabel = text(props.yLabel);
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all, kind === "bar" ? 0 : -Infinity);
  const top = hi === lo ? lo + 1 : hi;
  const yt = niceTicks(lo, top, 5);
  const yMax = Math.max(top, yt.at(-1) ?? top);
  const yMin = Math.min(lo, yt[0] ?? lo);
  const W = 640;
  const H = 360;
  const m = { l: 52, r: 16, t: 14, b: xLabel ? 62 : 48 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const sy = (y: number) => m.t + (1 - (y - yMin) / (yMax - yMin)) * ph;
  const xs = kind === "scatter" ? labels.map(Number) : [];
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const sxScatter = (x: number) => m.l + (xHi === xLo ? 0.5 : (x - xLo) / (xHi - xLo)) * pw;
  const band = pw / Math.max(1, labels.length);
  const sxBand = (i: number) => m.l + band * (i + 0.5);
  const barW = Math.min(46, (band * 0.7) / Math.max(1, series.length));
  return (
    <figure className={styles.graph}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind} chart${title ? `: ${title}` : ""}. ${series.map((s) => `${s.name}: ${s.values.map(fmt).join(", ")}`).join("; ")}`} className={styles.svg}>
        <rect x={m.l} y={m.t} width={pw} height={ph} className={styles.plotArea} />
        {yt.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + pw} y1={sy(t)} y2={sy(t)} className={t === 0 ? styles.axis : styles.grid} />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className={styles.tick}>{tickLabel(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={kind === "scatter" ? sxScatter(Number(l)) : sxBand(i)} y={m.t + ph + 16} textAnchor="middle" className={styles.tick}>{l.length > 12 ? `${l.slice(0, 11)}…` : l}</text>
        ))}
        {kind === "bar" && series.map((s, si) => s.values.map((v, i) => {
          const x = sxBand(i) - (barW * series.length) / 2 + si * barW;
          const y0 = sy(0);
          const y1 = sy(v);
          return <rect key={`${si}-${i}`} x={x} y={Math.min(y0, y1)} width={barW - 2} height={Math.max(1, Math.abs(y0 - y1))} fill={PALETTE[si % PALETTE.length]!.stroke} />;
        }))}
        {kind === "line" && series.map((s, si) => (
          <g key={si}>
            <polyline points={s.values.map((v, i) => `${sxBand(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")} fill="none" stroke={PALETTE[si % PALETTE.length]!.stroke} strokeWidth={2.4} strokeDasharray={PALETTE[si % PALETTE.length]!.dash} />
            {s.values.map((v, i) => <circle key={i} cx={sxBand(i)} cy={sy(v)} r={3.5} fill={PALETTE[si % PALETTE.length]!.stroke} />)}
          </g>
        ))}
        {kind === "scatter" && series.map((s, si) => s.values.map((v, i) => <circle key={`${si}-${i}`} cx={sxScatter(Number(labels[i]))} cy={sy(v)} r={4.5} fill={PALETTE[si % PALETTE.length]!.stroke} />))}
        {xLabel ? <text x={m.l + pw / 2} y={H - 8} textAnchor="middle" className={styles.axisLabel}>{xLabel}</text> : null}
        {yLabel ? <text transform={`translate(14 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle" className={styles.axisLabel}>{yLabel}</text> : null}
      </svg>
      <ul className={styles.legend}>
        {series.map((s, i) => (
          <li key={i}>
            <svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" fill={PALETTE[i % PALETTE.length]!.stroke} /></svg>
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
      <details className={styles.dataDetails}>
        <summary>Show the data as a table</summary>
        <div className={styles.scroll} tabIndex={0} role="group" aria-label="Chart data">
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">{xLabel || "Label"}</th>{series.map((s, i) => <th key={i} scope="col">{s.name}</th>)}</tr>
            </thead>
            <tbody>
              {labels.map((l, r) => <tr key={r}><th scope="row">{l}</th>{series.map((s, i) => <td key={i}>{fmt(s.values[r] ?? Number.NaN)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </details>
      <button type="button" className={styles.linkButton} disabled={!canAsk} onClick={() => ask(`Can you explain this chart${title ? `: ${title}` : ""}?`)}>
        Explain this chart
      </button>
    </figure>
  );
}

export function ProbabilityTree({ props }: Render) {
  const branches = partsOf<{ label?: string; p?: unknown; then?: unknown }>(props.branches);
  const title = text(props.title);
  const total = branches.reduce((n, b) => n + asNumber(b.p), 0);
  return (
    <figure className={styles.tree}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <ul>
        {branches.map((b, i) => {
          const p1 = asNumber(b.p);
          const then = partsOf<{ label?: string; p?: unknown }>(b.then);
          return (
            <li key={i}>
              <span className={styles.branch}><Rich text={b.label} /> <span className={styles.prob}>{fmt(p1)}</span></span>
              {then.length ? (
                <ul>
                  {then.map((t, j) => (
                    <li key={j}>
                      <span className={styles.branch}><Rich text={t.label} /> <span className={styles.prob}>{fmt(asNumber(t.p))}</span></span>
                      <span className={styles.outcome}>
                        {text(b.label)} then {text(t.label)}: {fmt(p1)} × {fmt(asNumber(t.p))} = <strong>{fmt(p1 * asNumber(t.p))}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className={styles.count}>The first-stage probabilities add up to {fmt(total)}.</p>
    </figure>
  );
}
