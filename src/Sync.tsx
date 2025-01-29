// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import { useAsyncInterval } from "@dwidge/hooks-react";
import {
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
  trigger?: () => Promise<boolean>;
  abort?: () => void;
  onSyncEvent: OnSyncEvent;
  syncIntervalSeconds?: number;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const syncTablesMock = () => async () => {
  console.log("syncTablesMock1: Syncing tables...");
  return new Promise<void>((resolve) => setTimeout(resolve, 1000));
};

export const SyncProvider: React.FC<
  PropsWithChildren<
    Pick<SyncContextValue, "onSyncEvent" | "syncIntervalSeconds"> & {
      syncTables?: (
        signal: AbortSignal,
        onSyncEvent: OnSyncEvent,
      ) => Promise<void>;
    }
  >
> = ({
  children,
  syncTables = syncTablesMock,
  onSyncEvent = makeSyncEventHandler(),
  syncIntervalSeconds = 10,
}) => {
  
  const parentContext = useContext(SyncContext);
  if (parentContext)
    console.warn(
      "SyncProviderW1: There are multiple SyncProviders in your app.",
    );

  const triggerSync: (signal: AbortSignal) => Promise<boolean> = useCallback(
    async (signal: AbortSignal) => {
      if (!syncTables) {
        onSyncEvent({ type: "sync-ignored", reason: "Sync disabled or busy" });
        return false;
      } else {
        onSyncEvent({ type: "sync-start" });
        try {
          await syncTables(signal, onSyncEvent);
          onSyncEvent({ type: "sync-end", success: true });
          onSyncEvent({ type: "user", message: "Synchronized" });
          return true;
        } catch (e) {
          onSyncEvent({ type: "sync-end", success: false });
          if (signal.aborted) {
            onSyncEvent({ type: "user", message: "Cancelled" });
            return true;
          } else {
            if (
              e instanceof Error &&
              e.message.includes("attachBaseUrlInterceptor")
            ) {
              onSyncEvent({ type: "user", message: "Offline" });
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
    },
    [syncTables, onSyncEvent],
  );

  const { id, lastRunTime, lastResult, lastError, isRunning, trigger, abort } =
    useAsyncInterval<undefined, boolean, typeof triggerSync>(
      syncIntervalSeconds,
      triggerSync,
      undefined,
    );

  const online = !lastError && !!lastResult && !!lastRunTime;

  const value: SyncContextValue = useMemo(
    () => ({
      busy: isRunning,
      online,
      trigger: trigger ? () => trigger(undefined) : undefined,
      abort,
      onSyncEvent,
      lastSyncTime: lastRunTime,
      syncIntervalSeconds: syncIntervalSeconds,
    }),
    [
      isRunning,
      online,
      trigger,
      abort,
      onSyncEvent,
      lastRunTime,
      syncIntervalSeconds,
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
  const { trigger, abort } = useSyncContext();
  return { trigger, abort };
};

export const useSyncMode = () => {
  const { online, busy, lastSyncTime } = useSyncContext();
  return { online, busy, lastSyncTime };
};
