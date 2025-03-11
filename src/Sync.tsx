// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import { useAsyncInterval, useAsyncSemaphore } from "@dwidge/hooks-react";
import { sleep } from "@dwidge/utils-js";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";

export type SyncStats = { created: number; updated: number; deleted: number };

export type VerboseSyncEvent = {
  type: "verbose";
  message: string;
  data?: unknown[];
};

export type PullSyncEvent = {
  type: "pull";
  table: string;
  stats: SyncStats;
};

export type PushSyncEvent = {
  type: "push";
  table: string;
  stats: SyncStats;
};

export type ErrorSyncEvent = {
  type: "error";
  error: Error;
};

export type StartSyncEvent = {
  type: "sync-start";
};

export type EndSyncEvent = {
  type: "sync-end";
  success: boolean;
};

export type SkipSyncEvent = {
  type: "sync-ignored";
  reason: string;
};

export type UserSyncEvent = {
  type: "user";
  message: string;
};

export type ProgressSyncEvent = {
  type: "progress";
  progress: number; // 0 to 1
};

export type SyncEventType =
  | VerboseSyncEvent
  | PullSyncEvent
  | PushSyncEvent
  | ErrorSyncEvent
  | StartSyncEvent
  | EndSyncEvent
  | SkipSyncEvent
  | UserSyncEvent
  | ProgressSyncEvent;

export type OnSyncEvent = (event: SyncEventType) => void;

export const makeSyncEventHandler =
  (
    handlers: { [key in SyncEventType["type"]]?: (event: any) => void } = {
      error: (event: ErrorSyncEvent) =>
        console.log("ErrorSyncEvent", event.error),
      user: (event: UserSyncEvent) =>
        console.log("UserSyncEvent", event.message),
      progress: (e: ProgressSyncEvent) =>
        console.log("ProgressSyncEvent", `${(e.progress * 100).toFixed(0)}%`),
    },
    catchall: (event: SyncEventType) => void = (event: SyncEventType) =>
      console.log("SyncEvent", event),
  ) =>
  (event: SyncEventType): unknown =>
    (handlers[event.type] ?? catchall)(event);

export interface SyncContextValue {
  lastSyncTime: Date | null;
  busy: boolean;
  online: boolean;
  triggerPull?: () => Promise<boolean>;
  triggerPush?: () => Promise<boolean>;
  abort?: () => void;
  onSyncEvent: OnSyncEvent;
  syncIntervalSeconds?: number;
  pushIntervalSeconds?: number;
  reset?: () => void;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const isNetworkError = (e: unknown) =>
  e instanceof Error &&
  (e.message.includes("pingUrls") || e.message.includes("Network Error"));

export const SyncProvider: React.FC<
  PropsWithChildren<
    Pick<
      SyncContextValue,
      "onSyncEvent" | "syncIntervalSeconds" | "pushIntervalSeconds"
    > & {
      syncTables?: (
        signal: AbortSignal,
        onSyncEvent: OnSyncEvent,
        pull?: boolean,
      ) => Promise<void>;
      resetTables?: () => Promise<void>;
      enable?: boolean;
    }
  >
> = ({
  children,
  syncTables,
  resetTables,
  onSyncEvent = makeSyncEventHandler(),
  syncIntervalSeconds = 180,
  pushIntervalSeconds = 10,
  enable,
}) => {
  const parentContext = useContext(SyncContext);
  if (parentContext)
    console.warn(
      "SyncProviderW1: There are multiple SyncProviders in your app.",
    );

  const semaphore = useAsyncSemaphore<boolean>(); // Shared semaphore

  const triggerSync:
    | ((signal: AbortSignal, pull?: boolean) => Promise<boolean>)
    | undefined = useMemo(
    () =>
      syncTables
        ? async (signal: AbortSignal, pull = true) => {
            if (!syncTables) {
              onSyncEvent({
                type: "sync-ignored",
                reason: "Sync disabled or busy",
              });
              return false;
            } else {
              onSyncEvent({ type: "sync-start" });
              try {
                await syncTables(signal, onSyncEvent, pull);
                onSyncEvent({ type: "sync-end", success: true });
                if (pull)
                  onSyncEvent({ type: "user", message: "Sync completed" });
                return true;
              } catch (e) {
                onSyncEvent({ type: "sync-end", success: false });
                if (signal.aborted) {
                  if (pull)
                    onSyncEvent({ type: "user", message: "Sync cancelled" });
                  return true;
                } else {
                  if (isNetworkError(e)) {
                    if (pull) onSyncEvent({ type: "user", message: "Offline" });
                    return false;
                  } else {
                    onSyncEvent({
                      type: "error",
                      error: e instanceof Error ? e : new Error(`${e}`),
                    });
                    throw e;
                  }
                }
              }
            }
          }
        : undefined,
    [syncTables, onSyncEvent],
  );

  const triggerSyncPull:
    | ((signal: AbortSignal) => Promise<boolean>)
    | undefined = useMemo(
    () =>
      triggerSync
        ? async (signal: AbortSignal) => triggerSync(signal, true)
        : undefined,
    [triggerSync],
  );

  const triggerSyncPush:
    | ((signal: AbortSignal) => Promise<boolean>)
    | undefined = useMemo(
    () =>
      triggerSync
        ? async (signal: AbortSignal) => triggerSync(signal, false)
        : undefined,
    [triggerSync],
  );

  const { id, lastResult, lastError, isRunning, abort, reset } = semaphore;

  const { trigger: triggerPull, lastRunTime } = useAsyncInterval<
    undefined,
    boolean,
    typeof triggerSync
  >(syncIntervalSeconds, triggerSyncPull, undefined, enable, semaphore);

  const { trigger: triggerPush } = useAsyncInterval<
    undefined,
    boolean,
    typeof triggerSyncPush
  >(pushIntervalSeconds, triggerSyncPush, undefined, enable, semaphore);

  const online = !lastError && !!lastResult && !!lastRunTime;

  const myReset = useCallback(async () => {
    await sleep(0);
    await reset();
    await sleep(0);
    await resetTables?.();
    await sleep(0);
  }, [reset, resetTables]);

  const value: SyncContextValue = useMemo(
    () => ({
      busy: isRunning,
      online,
      triggerPull: triggerPull ? () => triggerPull(undefined) : undefined,
      triggerPush: triggerPush ? () => triggerPush(undefined) : undefined,
      abort,
      onSyncEvent,
      lastSyncTime: lastRunTime,
      syncIntervalSeconds,
      pushIntervalSeconds,
      reset: myReset,
    }),
    [
      isRunning,
      online,
      triggerPull,
      triggerPush,
      abort,
      onSyncEvent,
      lastRunTime,
      syncIntervalSeconds,
      pushIntervalSeconds,
      myReset,
    ],
  );

  // console.log("SyncProvider1", id);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSyncContext = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSyncContext must be used within a SyncProvider");
  }
  return context;
};

export const useSyncTrigger = () => {
  const { triggerPull, triggerPush, abort, reset } = useSyncContext();
  return { trigger: triggerPull, triggerPull, triggerPush, abort, reset };
};

export const useSyncStatus = () => {
  const { online, busy, lastSyncTime } = useSyncContext();
  return { online, busy, pending: true, lastSyncTime };
};
