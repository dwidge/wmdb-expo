import { QueryOptions, StringKey } from "@dwidge/crud-api-react";
import { BaseType } from "./BaseType.js";

export const applyQueryOptions = <T extends BaseType>(
  items: T[],
  options: QueryOptions<StringKey<T>>,
): T[] => {
  let result = items;
  const { order, offset, limit } = options;

  if (order && order.length > 0) {
    result = [...result].sort((a, b) => {
      for (const [key, dir] of order) {
        const aVal = a[key as keyof T];
        const bVal = b[key as keyof T];
        if (aVal < bVal) return dir === "ASC" ? -1 : 1;
        if (aVal > bVal) return dir === "ASC" ? 1 : -1;
      }
      return 0;
    });
  }

  if (offset) {
    result = result.slice(offset);
  }

  if (limit) {
    result = result.slice(0, limit);
  }

  return result;
};
