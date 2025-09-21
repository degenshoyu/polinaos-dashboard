// hooks/useMaxRoiProgress.ts
"use client";

import * as React from "react";

type Progress = {
  total: number;
  done: number;
  inFlight: number;
  updating: boolean;
};
type Store = Progress & { lastCompletedAt?: number };

let state: Store = {
  total: 0,
  done: 0,
  inFlight: 0,
  updating: false,
  lastCompletedAt: undefined,
};
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export function useMaxRoiProgress() {
  const [snap, setSnap] = React.useState<Store>(state);
  React.useEffect(() => {
    const cb = () => setSnap({ ...state });
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, []);
  return {
    progress: {
      total: snap.total,
      done: snap.done,
      inFlight: snap.inFlight,
      updating: snap.updating,
    },
  };
}

export function beginBatch(n: number) {
  if (!n || n < 0) return;
  state.total += n;
  state.inFlight += n;
  state.updating = true;
  emit();
}

export function markDone(n: number) {
  if (!n || n < 0) return;
  state.done += n;
  state.inFlight = Math.max(0, state.inFlight - n);
  if (state.done >= state.total) {
    state.updating = false;
    state.lastCompletedAt = Date.now();
  }
  emit();
}

export function resetMaxRoiProgress() {
  state.total = 0;
  state.done = 0;
  state.inFlight = 0;
  state.updating = false;
  state.lastCompletedAt = undefined;
  emit();
}
