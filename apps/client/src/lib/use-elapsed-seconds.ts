import { useEffect, useRef, useState } from "react";

const MS_IN_S = 1000;

export function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState<number>();
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (startedAt.current === null) {
        startedAt.current = Date.now();
        setSeconds(0);
      }
      const timer = window.setInterval(() => {
        if (startedAt.current !== null) {
          setSeconds(Math.floor((Date.now() - startedAt.current) / MS_IN_S));
        }
      }, MS_IN_S);
      return () => window.clearInterval(timer);
    }
    if (startedAt.current !== null) {
      setSeconds(
        Math.max(1, Math.ceil((Date.now() - startedAt.current) / MS_IN_S)),
      );
      startedAt.current = null;
    }
  }, [active]);

  return seconds;
}
