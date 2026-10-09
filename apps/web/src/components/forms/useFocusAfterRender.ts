"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Moves focus to an element that only exists after the next render (an error summary, a failure message, the
 * "sent" panel). Focusing from `requestAnimationFrame` can run before React has committed that element on a busy
 * page, and then focus is silently lost; an effect runs only after the commit, so the element is always there.
 *
 *   const focusAfterRender = useFocusAfterRender();
 *   setStatus("sent");
 *   focusAfterRender(resultRef);
 */
export function useFocusAfterRender() {
  const [request, setRequest] = useState<{ target: RefObject<HTMLElement | null>; count: number } | null>(null);

  useEffect(() => {
    request?.target.current?.focus();
  }, [request]);

  return useCallback((target: RefObject<HTMLElement | null>) => {
    setRequest((current) => ({ target, count: (current?.count ?? 0) + 1 }));
  }, []);
}
