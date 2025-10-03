export interface WmdbMetrics {
  readQueries: number;
  writeOperations: number;
  rowsRead: number;
  rowsWritten: number;
}

export const wmdbMetrics: WmdbMetrics = {
  readQueries: 0,
  writeOperations: 0,
  rowsRead: 0,
  rowsWritten: 0,
};
