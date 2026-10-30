"use client";

import { Component, useCallback, useMemo, useState, type ReactNode } from "react";
import { Renderer, type ActionEvent, type ParseResult } from "@openuidev/react-lang";
import { interfaceSummary, parseStoredMessage } from "@/lib/openui/format";
import { RenderedAnswer } from "../study-buddy/RenderedAnswer";
import { HostProvider } from "./host";
import { library } from "./library";
import styles from "./openui.module.css";

/**
 * An interactive answer, drawn by OpenUI's own streaming renderer from the program the server checked.
 *
 * `content` is either the stored form of a finished interface (its program plus what the server verified) or, while one is still arriving, the program so
 * far. While it arrives every control is switched off, because it has not passed its checks yet; the moment the server's `final` event replaces it, the
 * controls work. If anything about drawing it fails (a parse problem, a component that throws) the student is shown a plain-text version of what it said,
 * with a line saying so, and never the program itself. This module (OpenUI, its parser, and these components) is only downloaded when a conversation has an
 * interface in it.
 */
interface Props {
  content: string;
  streaming: boolean;
  /** Another answer is being written, so a question cannot be sent right now. */
  busy: boolean;
  /** Sends a message into the conversation as the student. */
  onAsk: (message: string) => void;
  maxChars: number;
}

class Boundary extends Component<{ fallback: ReactNode; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PlainVersion({ program }: { program: string }) {
  const said = interfaceSummary(program, 4000);
  return (
    <div className={styles.plain} role="note">
      <p><strong>This interactive answer could not be shown, so here is what it said in text.</strong></p>
      {said ? <RenderedAnswer text={said} /> : <p>It had nothing that can be shown as text. Please ask again.</p>}
    </div>
  );
}

export default function InterfaceMessage({ content, streaming, busy, onAsk, maxChars }: Props) {
  const stored = useMemo(() => parseStoredMessage(content), [content]);
  // A message with no marker is a draft program still arriving (the server's `final` event replaces it with the stored form).
  const program = stored.kind === "interface" ? stored.program : content;
  const context = stored.kind === "interface" ? stored.context : { v: 1 as const, verifications: [], sources: [] };
  const [broken, setBroken] = useState(false);
  const enabled = !streaming && stored.kind === "interface";
  const canAsk = enabled && !busy;

  const ask = useCallback(
    (message: string) => {
      const clean = message.replace(/\s+/g, " ").trim().slice(0, maxChars);
      if (clean && canAsk) onAsk(clean);
    },
    [canAsk, maxChars, onAsk],
  );

  // The ONLY action a program can cause beyond what a component does itself is to continue the conversation, and that is a message sent as the student,
  // through the same route, checks and limits as anything typed. Opening an address, setting a variable of the page, running a tool: all ignored.
  const onAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === "continue_conversation" && typeof event.humanFriendlyMessage === "string") ask(event.humanFriendlyMessage);
    },
    [ask],
  );

  const onParse = useCallback(
    (result: ParseResult | null) => {
      // Once the interface is complete, one that has no root, or whose root is not drawable, is broken. (While it streams, no root yet is normal.)
      if (!streaming && stored.kind === "interface" && (!result || !result.root)) setBroken(true);
    },
    [streaming, stored.kind],
  );

  if (broken) return <PlainVersion program={program} />;
  return (
    <div className={styles.root} aria-busy={streaming || undefined} data-streaming={streaming ? "true" : undefined}>
      <Boundary fallback={<PlainVersion program={program} />} onFail={() => setBroken(true)}>
        <HostProvider value={{ context, ask, enabled, canAsk, maxChars }}>
          <Renderer response={program} library={library} isStreaming={streaming} onAction={onAction} onParseResult={onParse} />
        </HostProvider>
      </Boundary>
    </div>
  );
}
