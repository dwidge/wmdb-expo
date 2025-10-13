export type ConvertItem<A, D> = (v: A) => D;
export type AssertItem<T> = ConvertItem<T, T>;
export type ParseItem<T> = ConvertItem<any, T>;

export type BaseType = {
  id: string;
  updatedAt: number;
  createdAt: number;
  deletedAt: number | null;
};
