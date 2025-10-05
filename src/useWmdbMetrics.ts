import { ApiMetrics } from "@dwidge/crud-api-react";
import { useCallback, useRef } from "react";
import { useDebouncedPoll } from "./useDebouncedPoll.js";

export const createWmdbMetricsLogger = (name: string) => (v: ApiMetrics) =>
  console.log(
    `WatermelonDB[${name}]: Read ${v.read.ops} ${v.read.rows} - Write ${v.write.ops} ${v.write.rows}`,
  );

export const useWmdbMetrics = (
  metrics?: ApiMetrics,
  log = createWmdbMetricsLogger(metrics?.name ?? "*"),
) => {
  const lastLoggedMetricsRef = useRef<ApiMetrics>({
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
    (): ApiMetrics | undefined =>
      metrics
        ? {
            read: { ...metrics.read },
            write: { ...metrics.write },
          }
        : undefined,
    [metrics],
  );

  const isChanged = useCallback(
    (prev?: ApiMetrics, curr?: ApiMetrics): boolean =>
      prev && curr
        ? prev.read.ops !== curr.read.ops ||
          prev.read.rows !== curr.read.rows ||
          prev.write.ops !== curr.write.ops ||
          prev.write.rows !== curr.write.rows
        : false,
    [],
  );

  const onStable = useCallback(() => {
    const currentMetrics = getter();
    if (!metrics || !currentMetrics) return;

    const delta: ApiMetrics = {
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

  useDebouncedPoll<ApiMetrics | undefined>(
    getter,
    isChanged,
    onStable,
    250,
    1000,
  );
};
