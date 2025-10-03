import { useEffect, useRef } from "react";
import { wmdbMetrics, WmdbMetrics } from "./metrics";

export const useWmdbMetrics = (
  log = (v: WmdbMetrics) => console.log("WatermelonDB Metrics", v),
) => {
  const prevMetricsRef = useRef<WmdbMetrics | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentMetrics: WmdbMetrics = { ...wmdbMetrics };

      const prevMetrics = prevMetricsRef.current;
      if (
        prevMetrics === null ||
        JSON.stringify(prevMetrics) !== JSON.stringify(currentMetrics)
      ) {
        log(currentMetrics);
        prevMetricsRef.current = currentMetrics;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [log]);
};
