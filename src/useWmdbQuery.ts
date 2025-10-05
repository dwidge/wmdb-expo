// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

// Modified from:
// https://github.com/Nozbe/WatermelonDB/issues/1796

import { ApiMetrics, QueryOptions, StringKey } from "@dwidge/crud-api-react";
import { Database, Model, Q, Query, TableName } from "@nozbe/watermelondb";
import { useDatabase } from "@nozbe/watermelondb/react";
import { useEffect, useState } from "react";

/**
 * Builds a WatermelonDB query.
 *
 * @template T - The type of the model.
 * @param {Database} database - WatermelonDB database instance.
 * @param {TableName<T>} tableName - The name of the table to query.
 * @param {Q.Clause[]} [query=[]] - An array of query clauses.
 * @param {QueryOptions} [options={}] - An object containing query options.
 * @returns {Query<T> | undefined} - WatermelonDB query object.
 */
export const buildWmdbQuery = <T extends Model>(
  database: Database,
  tableName: TableName<T>,
  query?: Q.Clause[],
  options: QueryOptions<StringKey<T>> & { columns?: StringKey<T>[] } = {},
): Query<T> | undefined => {
  if (!query) {
    return undefined;
  }

  let enhancedQuery = database.get<T>(tableName).query(query);

  if (options.order) {
    options.order.forEach(([column, direction]) => {
      enhancedQuery = enhancedQuery.extend(
        Q.sortBy(String(column), direction === "ASC" ? Q.asc : Q.desc),
      );
    });
  }

  if (options.limit !== undefined) {
    enhancedQuery = enhancedQuery.extend(Q.take(options.limit));
    if (options.offset !== undefined)
      enhancedQuery = enhancedQuery.extend(Q.skip(options.offset));
  }

  return enhancedQuery;
};

/**
 * A hook to query items from the WatermelonDB database.
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
  options: QueryOptions<StringKey<T>> & { columns?: StringKey<T>[] } = {},
  metrics?: ApiMetrics,
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
      return;
    }

    const enhancedQuery = buildWmdbQuery<T>(db, tableName, query, options);
    if (!enhancedQuery) throw new Error("useWmdbQueryE1");

    warnColumnsEmpty(options.columns);
    const columnsToObserve = options.columns || ["id" as StringKey<T>];

    const subscription = enhancedQuery
      .observeWithColumns(columnsToObserve)
      .subscribe((items) => {
        if (metrics) {
          metrics.read.ops++;
          metrics.read.rows += items.length;
        }
        setItems(items.map((v: any) => v._raw));
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [db, tableName, query, options]);

  return items;
};

/**
 * A hook to observe the count of items from the WatermelonDB database.
 *
 * @template T - The type of the model.
 * @param {TableName<T>} tableName - The name of the table to query.
 * @param {Q.Clause[]} [query=[]] - An array of query clauses.
 * @param {QueryOptions} [options={}] - An object containing query options. (Note: order, columns are ignored for count)
 * @returns {number | undefined} - The count of items or undefined.
 */
export const useWmdbCount = <T extends Model>(
  tableName: TableName<T>,
  query?: Q.Clause[],
  options: QueryOptions<StringKey<T>> = {},
  metrics?: ApiMetrics,
): number | undefined => {
  const [count, setCount] = useState<number | undefined>();
  const db = useDatabase();

  useEffect(() => {
    if (!query) {
      setCount(undefined);
      return;
    }

    const enhancedQuery = buildWmdbQuery<T>(db, tableName, query, options);
    if (!enhancedQuery) throw new Error("useWmdbCountE1");

    const subscription = enhancedQuery.observeCount().subscribe((count) => {
      if (metrics) {
        metrics.read.ops++;
      }
      setCount(count);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [db, tableName, query, options]);

  return count;
};
