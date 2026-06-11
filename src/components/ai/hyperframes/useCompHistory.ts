import { useCallback, useRef, useState } from "react";
import type { HyperframesComposition } from "./timeline";

const MAX_HISTORY = 50;

/**
 * Undo/redo history for a Hyperframes composition.
 * Coalesces rapid successive edits (typing in a text field) within `coalesceMs`.
 */
export function useCompHistory(initial: HyperframesComposition, coalesceMs = 400) {
  const [comp, setCompState] = useState<HyperframesComposition>(initial);
  const pastRef = useRef<HyperframesComposition[]>([]);
  const futureRef = useRef<HyperframesComposition[]>([]);
  const lastEditRef = useRef<number>(0);
  const [, force] = useState(0);

  const setComp = useCallback(
    (
      updater: HyperframesComposition | ((c: HyperframesComposition) => HyperframesComposition),
      opts?: { commit?: boolean },
    ) => {
      setCompState((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (c: HyperframesComposition) => HyperframesComposition)(prev)
            : updater;
        if (next === prev) return prev;
        const now = Date.now();
        const shouldCommit = opts?.commit ?? now - lastEditRef.current > coalesceMs;
        if (shouldCommit) {
          pastRef.current = [...pastRef.current, prev].slice(-MAX_HISTORY);
          futureRef.current = [];
        }
        lastEditRef.current = now;
        return next;
      });
      // bump for canUndo/canRedo readers
      force((n) => n + 1);
    },
    [coalesceMs],
  );

  const undo = useCallback(() => {
    setCompState((cur) => {
      const past = pastRef.current;
      if (!past.length) return cur;
      const prev = past[past.length - 1];
      pastRef.current = past.slice(0, -1);
      futureRef.current = [cur, ...futureRef.current].slice(0, MAX_HISTORY);
      lastEditRef.current = 0; // force next edit to commit
      return prev;
    });
    force((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    setCompState((cur) => {
      const fut = futureRef.current;
      if (!fut.length) return cur;
      const next = fut[0];
      futureRef.current = fut.slice(1);
      pastRef.current = [...pastRef.current, cur].slice(-MAX_HISTORY);
      lastEditRef.current = 0;
      return next;
    });
    force((n) => n + 1);
  }, []);

  const reset = useCallback((c: HyperframesComposition) => {
    pastRef.current = [];
    futureRef.current = [];
    lastEditRef.current = 0;
    setCompState(c);
    force((n) => n + 1);
  }, []);

  return {
    comp,
    setComp,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}