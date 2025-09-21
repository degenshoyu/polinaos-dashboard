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

// 保证不变量，防止 done>total / inFlight<0 等异常
function normalize() {
  state.total = Math.max(0, state.total);
  state.done = Math.min(state.total, Math.max(0, state.done));
  const maxInFlight = Math.max(0, state.total - state.done);
  state.inFlight = Math.min(maxInFlight, Math.max(0, state.inFlight));
  state.updating = state.total > 0 && state.done < state.total;
}

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
  normalize();
  emit();
}

export function markDone(n: number) {
  if (!n || n < 0) return;
  state.done += n;
  state.inFlight -= n;
  normalize();
  if (!state.updating && state.total > 0) state.lastCompletedAt = Date.now();
  emit();
}

export function resetMaxRoiProgress() {
  state.total = 0;
  state.done = 0;
  state.inFlight = 0;
  state.updating = false;
  state.lastCompletedAt = undefined;
  normalize();
  emit();
}
