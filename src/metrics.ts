export interface WmdbMetrics {
  read: {
    ops: number;
    rows: number;
  };
  write: {
    ops: number;
    rows: number;
  };
}

export const wmdbMetrics: WmdbMetrics = {
  read: {
    ops: 0,
    rows: 0,
  },
  write: {
    ops: 0,
    rows: 0,
  },
};
