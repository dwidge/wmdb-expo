import { ApiFilterObject, StringKey } from "@dwidge/crud-api-react";
import { dropUndefined } from "@dwidge/utils-js";
import { BaseType } from "./BaseType.js";

export const applyApiFilter = <T extends BaseType>(
  items: T[],
  filter?: ApiFilterObject<T>,
): T[] => {
  if (!filter || Object.keys(filter).length === 0) return items;
  return items.filter((item) => {
    for (const [k, rawValue] of Object.entries(dropUndefined(filter))) {
      const key = k as StringKey<T>;
      const itemValue = item[key];
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];

      if (values.length === 0) {
        return false;
      }

      let orMatch = false;
      for (const v of values) {
        if (typeof v === "object" && v !== null && "$range" in v) {
          const [lower, upper] = v.$range;
          let rangeMatch = true;
          if (lower != undefined && (itemValue == null || itemValue < lower)) {
            rangeMatch = false;
          }
          if (upper != undefined && (itemValue == null || itemValue >= upper)) {
            rangeMatch = false;
          }
          if (rangeMatch) {
            orMatch = true;
            break;
          }
        } else if (typeof v === "object" && v !== null && "$not" in v) {
          const notValue = v.$not;
          if (notValue !== undefined && itemValue !== notValue) {
            orMatch = true;
            break;
          }
        } else if (v !== undefined) {
          if (itemValue === v) {
            orMatch = true;
            break;
          }
        }
      }
      if (!orMatch) {
        return false;
      }
    }
    return true;
  });
};
