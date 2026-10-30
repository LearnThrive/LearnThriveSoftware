"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { RenderedAnswer } from "../study-buddy/RenderedAnswer";
import { asStrings, partsOf, useHost } from "./host";
import { Rich } from "./Rich";
import styles from "./openui.module.css";

/**
 * The general-purpose components. Every one draws its model-written strings as React text (never HTML), has a text label for anything a colour shows,
 * and works with the keyboard. The props arrive already validated against the library (lib/openui/validate.ts); what is read here is still checked for
 * shape, because a stored interface from an older library version must still draw.
 */
type Render = { props: Record<string, unknown>; renderNode: (value: unknown) => ReactNode };

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function Answer({ props, renderNode }: Render) {
  const { context } = useHost();
  const title = text(props.title);
  return (
    <div className={styles.answer} data-interface="answer">
      {title ? <h3 className={styles.answerTitle}><Rich text={title} /></h3> : null}
      {renderNode(props.children)}
      {context.sources.length ? (
        <p className={styles.sources}>
          <span>Pages read for this answer: </span>
          {context.sources.map((s, i) => (
            <span key={s.url}>
              {i ? ", " : ""}
              <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.host}<span className="sr-only"> (opens in a new tab)</span></a>
              <span className={styles.sourceTier}> ({s.tier || s.host})</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function Heading({ props }: Render) {
  const level = props.level === 1 || props.level === 3 ? props.level : 2;
  const Tag = (level === 1 ? "h4" : level === 3 ? "h6" : "h5") as "h4" | "h5" | "h6";
  return <Tag className={styles.heading}><Rich text={props.text} /></Tag>;
}

export function Text({ props }: Render) {
  return <div className={styles.text}><RenderedAnswer text={text(props.markdown)} /></div>;
}

const TONES = { info: ["Note", styles.toneInfo], tip: ["Tip", styles.toneTip], warning: ["Watch out", styles.toneWarning], success: ["Good to know", styles.toneSuccess] } as const;

export function Callout({ props }: Render) {
  const tone = (props.tone as keyof typeof TONES) in TONES ? (props.tone as keyof typeof TONES) : "info";
  const [label, cls] = TONES[tone];
  return (
    <aside className={`${styles.callout} ${cls}`} role="note">
      <strong className={styles.calloutLabel}>{label}</strong>
      <span><Rich text={props.text} /></span>
    </aside>
  );
}

export function Card({ props, renderNode }: Render) {
  const subtitle = text(props.subtitle);
  return (
    <section className={styles.card}>
      <h4 className={styles.cardTitle}><Rich text={props.title} /></h4>
      {subtitle ? <p className={styles.cardSubtitle}><Rich text={subtitle} /></p> : null}
      <div className={styles.stack}>{renderNode(props.children)}</div>
    </section>
  );
}

export function Tabs({ props, renderNode }: Render) {
  const id = useId();
  const tabs = partsOf<{ label?: string; children?: unknown }>(props.tabs);
  const [active, setActive] = useState(0);
  const current = Math.min(active, Math.max(0, tabs.length - 1));
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }
  if (!tabs.length) return null;
  return (
    <div className={styles.tabs}>
      <div role="tablist" className={styles.tabList}>
        {tabs.map((t, i) => (
          <button key={i} id={`${id}-tab-${i}`} type="button" role="tab" aria-selected={i === current} aria-controls={`${id}-panel-${i}`} tabIndex={i === current ? 0 : -1} className={styles.tab} onClick={() => setActive(i)} onKeyDown={(e) => onKey(e, i)}>
            <Rich text={t.label} />
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={i} id={`${id}-panel-${i}`} role="tabpanel" aria-labelledby={`${id}-tab-${i}`} hidden={i !== current} className={styles.tabPanel}>
          {i === current ? <div className={styles.stack}>{renderNode(t.children)}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Accordion({ props, renderNode }: Render) {
  const items = partsOf<{ title?: string; children?: unknown; open?: boolean }>(props.items);
  return (
    <div className={styles.accordion}>
      {items.map((item, i) => (
        <details key={i} className={styles.details} open={item.open === true}>
          <summary className={styles.summary}><Rich text={item.title} /></summary>
          <div className={`${styles.stack} ${styles.detailsBody}`}>{renderNode(item.children)}</div>
        </details>
      ))}
    </div>
  );
}

/** A table that may be wider than the screen: it scrolls on its own, and can be scrolled with the keyboard. */
function Scroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.scroll} tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function DataTable({ props }: Render) {
  const headers = asStrings(props.headers);
  const rows = Array.isArray(props.rows) ? (props.rows as unknown[]).map(asStrings) : [];
  const caption = text(props.caption);
  return (
    <Scroller label={caption || "Table"}>
      <table className={styles.table}>
        {caption ? <caption><Rich text={caption} /></caption> : null}
        <thead>
          <tr>{headers.map((h, i) => <th key={i} scope="col"><Rich text={h} /></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>{row.map((cell, c) => <td key={c}><Rich text={cell} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

export function Comparison({ props }: Render) {
  const columns = asStrings(props.columns);
  const rows = partsOf<{ label?: string; cells?: unknown }>(props.rows);
  const title = text(props.title);
  return (
    <Scroller label={title || "Comparison"}>
      <table className={styles.table}>
        {title ? <caption><Rich text={title} /></caption> : null}
        <thead>
          <tr>
            <td aria-hidden="true" />
            {columns.map((c, i) => <th key={i} scope="col"><Rich text={c} /></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <th scope="row"><Rich text={row.label} /></th>
              {asStrings(row.cells).map((cell, c) => <td key={c}><Rich text={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

export function Timeline({ props }: Render) {
  const events = partsOf<{ when?: string; title?: string; detail?: string }>(props.events);
  const title = text(props.title);
  return (
    <div>
      {title ? <h5 className={styles.heading}><Rich text={title} /></h5> : null}
      <ol className={styles.timeline}>
        {events.map((e, i) => (
          <li key={i}>
            <span className={styles.when}><Rich text={e.when} /></span>
            <strong><Rich text={e.title} /></strong>
            {e.detail ? <span className={styles.detail}><Rich text={e.detail} /></span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Steps({ props }: Render) {
  const items = partsOf<{ title?: string; detail?: string }>(props.items);
  const title = text(props.title);
  return (
    <div>
      {title ? <h5 className={styles.heading}><Rich text={title} /></h5> : null}
      <ol className={styles.steps}>
        {items.map((s, i) => (
          <li key={i}>
            <strong><Rich text={s.title} /></strong>
            <span><Rich text={s.detail} /></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Checklist({ props }: Render) {
  const items = asStrings(props.items);
  const title = text(props.title);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const id = useId();
  const toggle = (i: number) => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <fieldset className={styles.checklist}>
      <legend>{title ? <Rich text={title} /> : "Checklist"}</legend>
      {items.map((item, i) => (
        <label key={i} htmlFor={`${id}-${i}`} className={styles.check}>
          <input id={`${id}-${i}`} type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
          <span><Rich text={item} /></span>
        </label>
      ))}
      <p className={styles.count} role="status">{done.size} of {items.length} done</p>
    </fieldset>
  );
}

export function FollowUps({ props }: Render) {
  const { ask, canAsk } = useHost();
  const questions = asStrings(props.questions).slice(0, 4);
  return (
    <div className={styles.followUps} role="group" aria-label="Ask next">
      {questions.map((q) => (
        <button key={q} type="button" className={styles.chip} disabled={!canAsk} onClick={() => ask(q)}>
          <Rich text={q} />
        </button>
      ))}
    </div>
  );
}

export function KnowledgeOrganiser({ props }: Render) {
  const sections = partsOf<{ heading?: string; points?: unknown }>(props.sections);
  const title = text(props.title);
  return (
    <section className={styles.organiser}>
      {title ? <h5 className={styles.heading}><Rich text={title} /></h5> : null}
      <div className={styles.organiserGrid}>
        {sections.map((s, i) => (
          <div key={i} className={styles.organiserSection}>
            <h6><Rich text={s.heading} /></h6>
            <ul>{asStrings(s.points).map((p, j) => <li key={j}><Rich text={p} /></li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AOFeedback({ props }: Render) {
  const items = partsOf<{ objective?: string; comment?: string; level?: string }>(props.items);
  const title = text(props.title);
  return (
    <section className={styles.aoFeedback}>
      <h5 className={styles.heading}>{title ? <Rich text={title} /> : "Feedback"}</h5>
      <p className={styles.feedbackNote}>AI feedback on your work against the assessment objectives. It is not an exam board mark.</p>
      <dl>
        {items.map((it, i) => (
          <div key={i}>
            <dt><Rich text={it.objective} />{it.level ? <span className={styles.level}> · <Rich text={it.level} /></span> : null}</dt>
            <dd><Rich text={it.comment} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
