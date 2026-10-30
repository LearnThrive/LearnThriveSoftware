"use client";

import { Fragment, type ReactNode } from "react";
import { asStrings, partsOf } from "./host";
import { Rich } from "./Rich";
import styles from "./openui.module.css";

/**
 * Science components. They draw only what they are given: stages and formulas the model named (and the server checked, where it can: a symbol equation
 * must balance), laid out so they read the same on a phone as on a desktop. Nothing is drawn that has not been described, and nothing is illustrated
 * with an invented structure.
 */
type Render = { props: Record<string, unknown>; renderNode: (value: unknown) => ReactNode };
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function ProcessDiagram({ props }: Render) {
  const stages = partsOf<{ name?: string; detail?: string; inputs?: unknown; outputs?: unknown }>(props.stages);
  const title = text(props.title);
  const note = text(props.note);
  return (
    <figure className={styles.process}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <ol className={styles.stages}>
        {stages.map((s, i) => {
          const inputs = asStrings(s.inputs);
          const outputs = asStrings(s.outputs);
          return (
            <li key={i} className={styles.stage}>
              <span className={styles.stageNumber} aria-hidden="true">{i + 1}</span>
              <div>
                <strong><Rich text={s.name} /></strong>
                {s.detail ? <p><Rich text={s.detail} /></p> : null}
                {inputs.length ? <p className={styles.flow}><span>In:</span> {inputs.map((x) => <span key={x} className={styles.pill}><Rich text={x} /></span>)}</p> : null}
                {outputs.length ? <p className={styles.flow}><span>Out:</span> {outputs.map((x) => <span key={x} className={styles.pill}><Rich text={x} /></span>)}</p> : null}
              </div>
              {i < stages.length - 1 ? <span className={styles.arrow} aria-hidden="true">↓</span> : null}
            </li>
          );
        })}
      </ol>
      {note ? <p className={styles.count}><Rich text={note} /></p> : null}
    </figure>
  );
}

/** "6CO2" as 6CO₂: digits that follow a letter or a bracket are subscripts; the number in front is a coefficient and stays at full size. */
function Formula({ value }: { value: string }) {
  const out: ReactNode[] = [];
  let prev = "";
  for (let i = 0; i < value.length; ) {
    const ch = value[i]!;
    if (/\d/.test(ch) && /[A-Za-z)]/.test(prev)) {
      let j = i;
      while (j < value.length && /\d/.test(value[j]!)) j += 1;
      out.push(<sub key={i}>{value.slice(i, j)}</sub>);
      prev = value[j - 1]!;
      i = j;
      continue;
    }
    out.push(<Fragment key={i}>{ch}</Fragment>);
    prev = ch;
    i += 1;
  }
  return <>{out}</>;
}

export function Reaction({ props }: Render) {
  const reactants = asStrings(props.reactants);
  const products = asStrings(props.products);
  const conditions = text(props.conditions);
  const title = text(props.title);
  const plain = `${reactants.join(" plus ")} ${conditions ? `(${conditions}) ` : ""}gives ${products.join(" plus ")}`;
  return (
    <figure className={styles.reaction}>
      {title ? <figcaption className={styles.graphTitle}><Rich text={title} /></figcaption> : null}
      <div className={styles.equationLine} role="img" aria-label={plain}>
        <span>{reactants.map((r, i) => <Fragment key={i}>{i ? " + " : ""}<Formula value={r} /></Fragment>)}</span>
        <span className={styles.arrowBox}>
          {conditions ? <small>{conditions}</small> : null}
          <span aria-hidden="true">→</span>
        </span>
        <span>{products.map((r, i) => <Fragment key={i}>{i ? " + " : ""}<Formula value={r} /></Fragment>)}</span>
      </div>
    </figure>
  );
}
