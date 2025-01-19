// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import {
  createContext,
  useContext,
  useState,
  PropsWithChildren,
  useCallback,
  useRef,
  MutableRefObject,
  useEffect,
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

export type IntervalSetupSyncEvent = {
  type: "interval-setup";
  intervalSeconds: number;
};

export type IntervalClearedSyncEvent = {
  type: "interval-cleared";
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
  | IntervalSetupSyncEvent
  | IntervalClearedSyncEvent
  | UserSyncEvent
  | ProgressSyncEvent;

export type OnSyncEvent = (event: SyncEventType) => void;

export const makeSyncEventLogger =
  (logger: (...args: any[]) => unknown = console.log) =>
  (event: SyncEventType): unknown => {
    const loggers: { [key in SyncEventType["type"]]: (event: any) => void } = {
      verbose: (e: VerboseSyncEvent) =>
        logger("SyncEvent:", e.message, ...(e.data || [])),
      pull: (e: PullSyncEvent) =>
        logger("SyncEvent: PullChanges", e.table, e.stats),
      push: (e: PushSyncEvent) =>
        logger("SyncEvent: PushChanges", e.table, e.stats),
      error: (e: ErrorSyncEvent) => logger("SyncEvent: Error", e.error),
      "sync-start": () => logger("SyncEvent: Sync start"),
      "sync-end": (e: EndSyncEvent) =>
        logger("SyncEvent: Sync end, success:", e.success),
      "sync-ignored": (e: SkipSyncEvent) =>
        logger("SyncEvent: Sync ignored:", e.reason),
      "interval-setup": (e: IntervalSetupSyncEvent) =>
        logger(
          `SyncEvent: Setting up sync interval for ${e.intervalSeconds} seconds`,
        ),
      "interval-cleared": () => logger("SyncEvent: Clearing sync interval"),
      user: (e: UserSyncEvent) => logger("User Message:", e.message),
    };

    return loggers[event.type](event);
  };

export interface SyncContextValue {
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  online: boolean;
  setOnline: React.Dispatch<React.SetStateAction<boolean>>;
  syncTables: () => undefined | ((context: SyncContextValue) => Promise<void>);
  onSyncEvent: OnSyncEvent;
  busyRef: MutableRefObject<boolean>;
  lastSyncTime: number | null;
  setLastSyncTime: React.Dispatch<React.SetStateAction<number | null>>;
  syncIntervalSeconds?: number;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const syncTablesMock = () => async () => {
  console.log("syncTablesMock1: Syncing tables...");
  return new Promise<void>((resolve) => setTimeout(resolve, 1000));
};

export const SyncProvider: React.FC<
  PropsWithChildren<
    Pick<SyncContextValue, "syncTables" | "onSyncEvent" | "syncIntervalSeconds">
  >
> = ({
  children,
  syncTables = syncTablesMock,
  onSyncEvent = makeSyncEventLogger(),
  syncIntervalSeconds = 10,
}) => {
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const busyRef = useRef(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  const value: SyncContextValue = {
    busy,
    setBusy,
    online,
    setOnline,
    syncTables,
    onSyncEvent,
    busyRef,
    lastSyncTime,
    setLastSyncTime,
    syncIntervalSeconds,
  };

  useIntervalSync(value);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSyncContext = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSyncContext must be used within a SyncProvider");
  }
  return context;
};

export const useSyncTrigger = (context = useSyncContext()) => {
  const {
    setBusy,
    setOnline,
    busy: isBusy,
    syncTables,
    onSyncEvent,
    busyRef,
    setLastSyncTime,
  } = context;
  const syncTablesF = syncTables();

  const triggerSync = useCallback(async () => {
    onSyncEvent({ type: "verbose", message: "Sync try" });
    let success = false;

    if (busyRef.current) {
      onSyncEvent({ type: "sync-ignored", reason: "Sync already in progress" });
      return false;
    }

    if (!syncTablesF) {
      onSyncEvent({ type: "sync-ignored", reason: "Sync disabled" });
      return false;
    }

    onSyncEvent({ type: "sync-start" });
    busyRef.current = true;
    setBusy(true);

    try {
      await syncTablesF(context);
      onSyncEvent({ type: "user", message: "Synchronized" });
      setOnline(true);
      success = true;
    } catch (e) {
      onSyncEvent({ type: "user", message: "Offline" });
      onSyncEvent({
        type: "error",
        error: e instanceof Error ? e : new Error(`${e}`),
      });
      setOnline(false);
      success = false;
    } finally {
      setBusy(false);
      busyRef.current = false;
      onSyncEvent({ type: "sync-end", success });
      setLastSyncTime(Math.floor(Date.now() / 1000));
    }

    return success;
  }, [syncTablesF, setBusy, setOnline, onSyncEvent, busyRef, setLastSyncTime]);

  return syncTablesF && !isBusy ? triggerSync : undefined;
};

export const useSyncMode = () => {
  const { online, busy, lastSyncTime } = useSyncContext();
  return { online, busy, lastSyncTime };
};

export const useIntervalSync = (context = useSyncContext()) => {
  const { syncIntervalSeconds, onSyncEvent } = context;
  const triggerSync = useSyncTrigger(context);

  useEffect(() => {
    if (triggerSync && syncIntervalSeconds && syncIntervalSeconds > 0) {
      onSyncEvent({
        type: "interval-setup",
        intervalSeconds: syncIntervalSeconds,
      });
      const intervalId = setInterval(triggerSync, syncIntervalSeconds * 1000);
      return () => {
        onSyncEvent({ type: "interval-cleared" });
        clearInterval(intervalId);
      };
    } else {
      if (syncIntervalSeconds && syncIntervalSeconds <= 0) {
        onSyncEvent({
          type: "verbose",
          message:
            "syncIntervalSeconds should be greater than 0 to enable auto sync.",
        });
      }
    }
  }, [triggerSync, syncIntervalSeconds, onSyncEvent]);
};

export const useEventSync = (
  condition = false,
  context = useSyncContext(),
  triggerSync = useSyncTrigger(context),
) => {
  const { onSyncEvent } = context;
  useEffect(() => {
    if (condition && triggerSync) {
      onSyncEvent({
        type: "verbose",
        message: "Performing sync due to event.",
      });
      triggerSync();
    }
  }, [condition, triggerSync, onSyncEvent]);
  return triggerSync;
};
