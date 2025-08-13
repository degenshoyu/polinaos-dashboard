"use client";
import { useEffect, useRef, useState } from "react";

/** Local draft with debounce write */
export default function useLocalDraft<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(initialValue);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setState({ ...initialValue, ...JSON.parse(raw) });
    } catch {}
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {}
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, state]);

  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {}
    setState(initialValue);
  };

  return [state, setState, clear] as const;
}

