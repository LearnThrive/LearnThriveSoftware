"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HumanCheckAnswer, HumanChallenge, PowChallenge, TextChallenge } from "@/lib/human-check-core";

/**
 * The browser side of the human check (lib/human-check.ts has the idea and the server half). It fetches a
 * signed challenge, solves it in a Web Worker so the page never freezes, and holds the answer until the form
 * is sent. Solving starts when the page is idle, so it is usually done long before the visitor reaches the
 * submit button. A challenge works once, so after any submission that reached the server the form calls
 * `renew()`; and a quiet timer renews it before it expires.
 *
 * If this browser cannot run the proof (no Web Worker or no SubtleCrypto, or the worker fails or takes too
 * long), the server is asked for a short sum instead, so nobody is locked out. If the server cannot issue a
 * challenge at all, the state is `unavailable` and the form offers email.
 *
 * Nothing here uses a cookie or browser storage, and nothing leaves the site.
 */
export type HumanCheckState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "verified" }
  | { status: "text"; question: string }
  | { status: "failed" }
  | { status: "unavailable" };

const SOLVE_TIMEOUT_MS = 45_000;
const RENEW_BEFORE_EXPIRY_MS = 60_000;

export interface HumanCheckHandle {
  state: HumanCheckState;
  /** The answer to send with the form, or null while it is not ready. */
  getAnswer: () => HumanCheckAnswer | null;
  /** In the fallback, the visitor's typed answer. */
  setTextAnswer: (value: string) => void;
  textAnswer: string;
  /** Begin now (otherwise it begins when the page is idle, unless the form asked to wait: `auto: false`). */
  start: () => void;
  /** True while the form asked to wait for the visitor (`auto: false`) and has not been started yet. */
  deferred: boolean;
  /** Throw away the current answer and get a fresh one (call after the server may have spent it). */
  renew: () => void;
}

/**
 * `auto: false` is for a form on a page most visitors only read (the subject request on /subjects): the check then
 * starts when the visitor first touches the form, so a visit that never reaches the form costs no request and no work.
 */
export function useHumanCheck({ auto = true }: { auto?: boolean } = {}): HumanCheckHandle {
  const [state, setState] = useState<HumanCheckState>({ status: "idle" });
  const [textAnswer, setTextAnswerState] = useState("");
  const powAnswer = useRef<HumanCheckAnswer | null>(null);
  const textChallenge = useRef<TextChallenge | null>(null);
  const textValue = useRef("");
  const worker = useRef<Worker | null>(null);
  const timers = useRef<number[]>([]);
  const run = useRef(0);
  const started = useRef(false);
  // The renewal timer calls the latest `begin` through this, so a hook callback need not refer to itself.
  const beginRef = useRef<() => void>(() => undefined);

  const stop = useCallback(() => {
    run.current += 1;
    worker.current?.terminate();
    worker.current = null;
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const begin = useCallback(async () => {
    stop();
    const id = run.current;
    powAnswer.current = null;
    textChallenge.current = null;
    setState({ status: "working" });

    const fetchChallenge = async (mode: "pow" | "text"): Promise<HumanChallenge | "unavailable" | null> => {
      try {
        const response = await fetch(`/api/careers/challenge${mode === "text" ? "?mode=text" : ""}`, { cache: "no-store" });
        if (response.status === 503) return "unavailable";
        if (!response.ok) return null;
        return (await response.json()) as HumanChallenge;
      } catch {
        return null;
      }
    };

    const fallBackToText = async () => {
      const challenge = await fetchChallenge("text");
      if (id !== run.current) return;
      if (challenge === "unavailable") return setState({ status: "unavailable" });
      if (!challenge || challenge.kind !== "text") return setState({ status: "failed" });
      textChallenge.current = challenge;
      setState({ status: "text", question: challenge.question });
    };

    const canSolve = typeof Worker !== "undefined" && typeof crypto !== "undefined" && Boolean(crypto.subtle);
    if (!canSolve) return fallBackToText();

    const challenge = await fetchChallenge("pow");
    if (id !== run.current) return;
    if (challenge === "unavailable") return setState({ status: "unavailable" });
    if (!challenge || challenge.kind !== "pow") return setState({ status: "failed" });
    const pow: PowChallenge = challenge;

    try {
      const instance = new Worker(new URL("../../lib/human-check.worker.ts", import.meta.url));
      worker.current = instance;
      timers.current.push(
        window.setTimeout(() => {
          if (id !== run.current) return;
          instance.terminate();
          void fallBackToText();
        }, SOLVE_TIMEOUT_MS),
      );
      instance.onmessage = (event: MessageEvent<{ solution?: string; error?: string }>) => {
        if (id !== run.current) return;
        instance.terminate();
        worker.current = null;
        if (!event.data.solution) return void fallBackToText();
        powAnswer.current = { ...pow, solution: event.data.solution };
        setState({ status: "verified" });
        const renewIn = Math.max(1000, pow.expires - Date.now() - RENEW_BEFORE_EXPIRY_MS);
        timers.current.push(window.setTimeout(() => beginRef.current(), renewIn));
      };
      instance.onerror = () => {
        if (id !== run.current) return;
        instance.terminate();
        worker.current = null;
        void fallBackToText();
      };
      instance.postMessage({ challenge: pow.challenge, bits: pow.bits });
    } catch {
      void fallBackToText();
    }
  }, [stop]);

  useEffect(() => {
    beginRef.current = () => void begin();
  }, [begin]);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  const renew = useCallback(() => {
    started.current = true;
    textValue.current = "";
    setTextAnswerState("");
    void begin();
  }, [begin]);

  // Start when the page is idle (or after a short wait), so the work is usually finished by submit time.
  useEffect(() => {
    if (!auto) return;
    type IdleWindow = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => start(), { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(start, 1200);
    return () => window.clearTimeout(timer);
  }, [auto, start]);

  useEffect(() => stop, [stop]);

  const getAnswer = useCallback((): HumanCheckAnswer | null => {
    if (powAnswer.current) return powAnswer.current;
    const challenge = textChallenge.current;
    if (challenge && textValue.current.trim()) {
      return { kind: "text", id: challenge.id, expires: challenge.expires, signature: challenge.signature, answer: textValue.current.trim() };
    }
    return null;
  }, []);

  const setTextAnswer = useCallback((value: string) => {
    textValue.current = value;
    setTextAnswerState(value);
  }, []);

  return { state, getAnswer, setTextAnswer, textAnswer, start, deferred: !auto && state.status === "idle", renew };
}
