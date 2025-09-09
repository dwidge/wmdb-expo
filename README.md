# License

Copyright DWJ 2024.  
Distributed under the Boost Software License, Version 1.0.  
https://www.boost.org/LICENSE_1_0.txt

## Sync Progress

The `SyncProvider` and related hooks provide detailed progress tracking for synchronization operations. This allows you to build UIs that reflect the current state of the sync process.

### `useSyncStatus()`

This hook is the primary way to access sync status information. In addition to `busy`, `online`, and `lastSyncTime`, it now returns:

- `pullProgress`: A number between 0 and 1 representing the progress of the data-pulling phase. It is `null` if the current sync operation does not include a pull phase (e.g., a push-only sync).
- `pushProgress`: A number between 0 and 1 representing the progress of the data-pushing phase.
- `pulling`: A boolean that is `true` when the pull phase is actively in progress (progress is > 0 and < 1).
- `pushing`: A boolean that is `true` when the push phase is actively in progress (progress is > 0 and < 1).

### Progress States

You can determine the state of each phase (pull/push) using the progress values:

- **Pending:** The progress value is `0`. The phase is queued but has not started processing data.
- **Active:** The progress value is greater than `0` and less than `1`. The `pulling` or `pushing` flag will be `true`.
- **Complete:** The progress value is `1`.
- **Not applicable/Disabled:** The `pullProgress` value is `null`.

The `busy` flag from `useSyncStatus()` indicates that an overall sync operation is in progress. When `busy` becomes `false`, the `pullProgress` and `pushProgress` values retain their last state until a new sync begins. This is useful for displaying final results or error states in your UI.
