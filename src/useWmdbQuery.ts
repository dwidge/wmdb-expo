// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

// Modified from:
// https://github.com/Nozbe/WatermelonDB/issues/1796

import { QueryOptions, StringKey } from "@dwidge/crud-api-react";
import { Model, Q, TableName } from "@nozbe/watermelondb";
import { useDatabase } from "@nozbe/watermelondb/react";
import { useEffect, useState } from "react";

/**
 * A custom hook to query items from the WatermelonDB database.
 *
 * @template T - The type of the model.
 * @param {TableName<T>} tableName - The name of the table to query.
 * @param {Q.Clause[]} [query=[]] - An array of query clauses.
 * @param {QueryOptions} [options={}] - An object containing query options.
 * @returns {T[] | undefined} - An array of items or undefined.
 */
export const useWmdbQuery = <T extends Model>(
  tableName: TableName<T>,
  query?: Q.Clause[],
  options: QueryOptions<StringKey<T>> = {},
): T[] | undefined => {
  const warnColumnsEmpty = <T extends Model>(columns?: StringKey<T>[]) => {
    if (!columns || !columns.length)
      console.warn(
        "warnColumnsEmptyE1: No columns to watch. Changes will not cause updates.",
        { tableName, columns },
      );
  };

  const [items, setItems] = useState<T[] | undefined>();
  const db = useDatabase();

  useEffect(() => {
    if (!query) {
      setItems(undefined);
    } else {
      let enhancedQuery = db.get<T>(tableName).query(query);

      if (options.order) {
        options.order.forEach(([column, direction]) => {
          enhancedQuery = enhancedQuery.extend(
            Q.sortBy(column, direction === "ASC" ? Q.asc : Q.desc),
          );
        });
      }

      if (options.limit !== undefined) {
        enhancedQuery = enhancedQuery.extend(Q.take(options.limit));
        if (options.offset !== undefined)
          enhancedQuery = enhancedQuery.extend(Q.skip(options.offset));
      }

      warnColumnsEmpty(options.columns);
      const columnsToObserve = options.columns || ["id" as StringKey<T>];

      const subscription = enhancedQuery
        .observeWithColumns(columnsToObserve)
        .subscribe((items) => setItems(items.map((v: any) => v._raw)));

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [db, query, options]);

  return items;
};
