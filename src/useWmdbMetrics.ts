import { useCallback, useRef } from "react";
import { wmdbMetrics, WmdbMetrics } from "./metrics.js";
import { useDebouncedPoll } from "./useDebouncedPoll.js";

export const useWmdbMetrics = (
  log = (v: WmdbMetrics) =>
    console.log(
      `WatermelonDB: Read ${v.read.ops} ${v.read.rows} - Write ${v.write.ops} ${v.write.rows}`,
    ),
) => {
  const lastLoggedMetricsRef = useRef<WmdbMetrics>({
    read: {
      ops: 0,
      rows: 0,
    },
    write: {
      ops: 0,
      rows: 0,
    },
  });

  const getter = useCallback(
    (): WmdbMetrics => ({
      read: { ...wmdbMetrics.read },
      write: { ...wmdbMetrics.write },
    }),
    [],
  );

  const isChanged = useCallback(
    (prev: WmdbMetrics, curr: WmdbMetrics): boolean =>
      prev.read.ops !== curr.read.ops ||
      prev.read.rows !== curr.read.rows ||
      prev.write.ops !== curr.write.ops ||
      prev.write.rows !== curr.write.rows,
    [],
  );

  const onStable = useCallback(() => {
    const currentMetrics = getter();
    const delta: WmdbMetrics = {
      read: {
        ops: currentMetrics.read.ops - lastLoggedMetricsRef.current.read.ops,
        rows: currentMetrics.read.rows - lastLoggedMetricsRef.current.read.rows,
      },
      write: {
        ops: currentMetrics.write.ops - lastLoggedMetricsRef.current.write.ops,
        rows:
          currentMetrics.write.rows - lastLoggedMetricsRef.current.write.rows,
      },
    };

    const hasChange =
      delta.read.ops !== 0 ||
      delta.read.rows !== 0 ||
      delta.write.ops !== 0 ||
      delta.write.rows !== 0;

    if (hasChange) {
      log(delta);
      lastLoggedMetricsRef.current = currentMetrics;
    }
  }, [log, getter]);

  useDebouncedPoll(getter, isChanged, onStable, 250, 1000);
};
