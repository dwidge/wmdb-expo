// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import { Fetch } from "@dwidge/crud-api-react";
import { asyncMap } from "@dwidge/utils-js";
import { Database } from "@nozbe/watermelondb";
import { synchronize } from "@nozbe/watermelondb/sync";
import merge from "ts-deepmerge";
import { OnSyncEvent } from "./Sync.js";
import { WatermelonSync } from "./useWatermelonSync.js";

/**
 * Synchronizes local WatermelonDB tables with a remote API.
 * The order of `tables` is crucial when dealing with foreign key constraints.
 * Tables should be ordered so that referenced tables are synced before the tables that link to them.
 * If tables are pulled/pushed in the wrong order, records with foreign keys to tables that haven't been pulled yet might be rejected.
 * Do not design your database with circular references. (Table A links to Table B and Table B links to Table A)
 * However, a table may reference itself, because records are synced in the same order they were created.
 * @async
 * @param {Fetch} fetch The fetch API instance used for making network requests.
 * @param {Database} database The WatermelonDB database instance.
 * @param {WatermelonSync<any>[]} tables An array of `WatermelonSync` objects, each representing a table to synchronize. The order of this array is important for foreign key constraints.
 * @param {OnSyncEvent} onSyncEvent Callback to send events.
 * @returns {Promise<void>} A promise that resolves when the synchronization is complete.
 */
export const syncTables = async (
  fetch: Fetch,
  database: Database,
  tables: WatermelonSync<any>[],
  onSyncEvent: OnSyncEvent,
  pull = true,
) =>
  synchronize({
    database,
    pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => {
      if (!pull) {
        return {
          changes: {},
          timestamp: lastPulledAt ?? 1,
        };
      }

      const r = await asyncMap(
        tables,
        async (table, index) => (
          onSyncEvent({
            type: "progress",
            progress: index / tables.length,
          }),
          table.pullChanges(
            fetch,
            {
              lastPulledAt,
              schemaVersion,
              migration,
            },
            onSyncEvent,
          )
        ),
      );
      onSyncEvent({
        type: "progress",
        progress: 1,
      });
      return merge(...r);
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      await asyncMap(tables, async (table, index) => {
        onSyncEvent({
          type: "progress",
          progress: index / tables.length,
        });
        await table.pushChanges(fetch, { changes, lastPulledAt }, onSyncEvent);
      });
      onSyncEvent({
        type: "progress",
        progress: 1,
      });
    },
    migrationsEnabledAtVersion: 1,
  }).catch(catchDiagnosticError);

const catchDiagnosticError = (e: unknown) => {
  // console.log("catchDiagnosticErrorE1", e);
  if (e instanceof Error) {
    const m = e.message.toString();
    if (m == "Cannot read properties of null (reading 'find')") {
      throw new Error(
        "catchDiagnosticErrorE2: Database has changed but did not migrate, please logout or reset the wmdb SQLLite/IndexDB",
      );
    }
  }
  throw e;
};
