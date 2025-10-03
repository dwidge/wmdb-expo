import { useEffect, useRef } from "react";
import { wmdbMetrics, WmdbMetrics } from "./metrics";

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

  useEffect(() => {
    const interval = setInterval(() => {
      const currentMetrics: WmdbMetrics = {
        read: { ...wmdbMetrics.read },
        write: { ...wmdbMetrics.write },
      };

      const delta: WmdbMetrics = {
        read: {
          ops: currentMetrics.read.ops - lastLoggedMetricsRef.current.read.ops,
          rows:
            currentMetrics.read.rows - lastLoggedMetricsRef.current.read.rows,
        },
        write: {
          ops:
            currentMetrics.write.ops - lastLoggedMetricsRef.current.write.ops,
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
    }, 1000);

    return () => clearInterval(interval);
  }, [log]);
};
