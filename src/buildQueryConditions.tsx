import { ApiFilterObject, ApiRecord, StringKey } from "@dwidge/crud-api-react";
import { dropUndefined } from "@dwidge/utils-js";
import { Q } from "@nozbe/watermelondb";

export const buildQueryConditions = <T extends ApiRecord>(
  filter?: ApiFilterObject<T>,
): Q.Where[] => {
  const conditions: Q.Where[] = [];
  if (filter) {
    for (const [k, rawValue] of Object.entries(dropUndefined(filter))) {
      const key = k as StringKey<T>;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const orConditions: Q.Where[] = [];

      if (values.length === 0) {
        conditions.push(Q.where("id", Q.eq(null)));
        break;
      }

      for (const v of values) {
        if (typeof v === "object" && v !== null && "$range" in v) {
          const [lower, upper] = v.$range;
          if (lower != undefined) {
            orConditions.push(Q.where(key, Q.gte(lower)));
          }
          if (upper != undefined) {
            orConditions.push(Q.where(key, Q.lt(upper)));
          }
        } else if (typeof v === "object" && v !== null && "$not" in v) {
          const notValue = v.$not;
          if (notValue !== undefined) {
            orConditions.push(Q.where(key, Q.notEq(notValue)));
          }
        } else if (v !== undefined) {
          orConditions.push(Q.where(key, v));
        }
      }
      if (orConditions.length > 0) {
        conditions.push(Q.or(...orConditions));
      }
    }
  }

  return conditions;
};
