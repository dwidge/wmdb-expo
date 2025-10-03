import { useEffect, useRef } from "react";

export const useDebouncedPoll = <T>(
  getter: () => T,
  isChanged: (prev: T, curr: T) => boolean,
  onStable: () => void,
  pollInterval: number = 500,
  debounceTime: number = 2000,
) => {
  const lastValueRef = useRef<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const initial = getter();
    lastValueRef.current = initial;

    const intervalId = setInterval(() => {
      const current = getter();
      const last = lastValueRef.current;
      if (last && isChanged(last, current)) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        lastValueRef.current = current;
        timeoutRef.current = setTimeout(() => {
          const now = getter();
          const lastSet = lastValueRef.current;
          if (lastSet && !isChanged(lastSet, now)) {
            onStable();
          }
          timeoutRef.current = null;
        }, debounceTime);
      }
    }, pollInterval);

    return () => {
      clearInterval(intervalId);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [getter, isChanged, onStable, pollInterval, debounceTime]);
};
