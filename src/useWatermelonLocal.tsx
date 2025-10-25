// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import {
  ApiFilterObject,
  ApiMetrics,
  assert,
  BaseApiHooks,
  QueryOptions,
  StringKey,
} from "@dwidge/crud-api-react";
import {
  AsyncDispatch,
  AsyncState,
  useDeepMemo,
  useMemoValue,
} from "@dwidge/hooks-react";
import { BigIntBase32, getUnixTimestamp } from "@dwidge/randid";
import { mergeObject } from "@dwidge/utils-js";
import type { Database } from "@nozbe/watermelondb";
import { Model, Q, TableName } from "@nozbe/watermelondb";
import React, { createContext, useContext, useMemo, useRef } from "react";

import { applyApiFilter } from "./applyApiFilter.js";
import { applyQueryOptions } from "./applyQueryOptions.js";
import { BaseType, ParseItem } from "./BaseType.js";
import { buildQueryConditions } from "./buildQueryConditions.js";
import { buildWmdbQuery, useWmdbCount, useWmdbQuery } from "./useWmdbQuery.js";

const _warnTooManyItems = <W extends Model>(
  table: TableName<W>,
  v: any[] | undefined,
  filter: any,
  columns: string[],
  wmdbQuery?: Q.Where[],
) => {
  if (v && v.length > 500)
    console.warn(
      "warnTooManyItemsE1: More than 500 items returned by query. Fix the query or add offset and limit to improve performance.",
      { table, filter, columns, wmdbQuery },
      v.slice(0, 3),
    );
};

const _updateItemsWmdb = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  parse: ParseItem<Partial<T>>,
  metrics: ApiMetrics,
  items: Partial<T>[],
  name = "updateItemsWmdb",
) => {
  let created: Partial<T>[] = [];
  await database.write(async () => {
    const records = await database
      .get<W>(table)
      .query(
        Q.where(
          "id",
          Q.oneOf(items.map((item) => BigIntBase32.parse(item.id as string))),
        ),
      )
      .fetch();

    const preparedUpdates = records.map((record) => {
      const matchingItem = items.find((item) => item.id === record.id);
      return record.prepareUpdate(
        (v) => (
          created.push(parse({ id: v.id })),
          mergeObject(v, {
            updatedAt2: getUnixTimestamp(),
            ...parse(matchingItem),
          })
        ),
      );
    });
    metrics.write.ops++;
    metrics.write.rows += items.length;
    return database.batch(...preparedUpdates);
  }, [table, name].join("."));
  return created;
};

const _createItems = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  parse: ParseItem<Partial<T>>,
  metrics: ApiMetrics,
  items: Partial<T>[],
  name = "createItems",
): Promise<Partial<T>[]> => {
  let created: Partial<T>[] = [];
  await database.write(() => {
    const collection = database.get<W>(table);
    const preparedCreates = items.map(parse).map(({ id, ...item }) =>
      collection.prepareCreate(
        (v) => (
          created.push(parse({ id: v.id })),
          mergeObject(v, {
            createdAt2: getUnixTimestamp(),
            updatedAt2: getUnixTimestamp(),
            ...parse(item),
          })
        ),
      ),
    );
    metrics.write.ops++;
    metrics.write.rows += items.length;
    return database.batch(...preparedCreates);
  }, [table, name].join("."));
  return created;
};

const _createItem = async <T extends BaseType>(
  createItems: (items: Partial<T>[]) => Promise<Partial<T>[]>,
  item: Partial<T>,
): Promise<Partial<T>> => (await createItems([item]))[0]!;

const _updateItem = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  parse: ParseItem<Partial<T>>,
  metrics: ApiMetrics,
  createItem: (item: Partial<T>) => Promise<Partial<T>>,
  { id, ...item }: Partial<T>,
  name = "updateItem",
): Promise<Partial<T>> =>
  id == null
    ? createItem(item as Partial<T>)
    : parse(
        await database.write(
          () =>
            database
              .get<W>(table)
              .find(BigIntBase32.parse(id))
              .then((r) =>
                r.update(
                  (v) => (
                    (metrics.write.ops += 1),
                    (metrics.write.rows += 1),
                    mergeObject(v, {
                      updatedAt2: getUnixTimestamp(),
                      ...item,
                    }),
                    v
                  ),
                ),
              ),
          [table, name].join("."),
        ),
      );

const _updateItems = async <T extends BaseType>(
  updateItem: (item: Partial<T>) => Promise<Partial<T>>,
  items: Partial<T>[],
) => {
  const updated: Partial<T>[] = [];
  for (const item of items) {
    updated.push(await updateItem(item));
  }
  return updated;
};

const _deleteItems = async <T extends BaseType>(
  updateItems: (items: Partial<T>[]) => Promise<Partial<T>[]>,
  items: Partial<T>[],
) =>
  updateItems(
    items.map((v) => ({
      ...v,
      deletedAt2: getUnixTimestamp(),
    })),
  );

const _restoreItems = async <T extends BaseType>(
  updateItems: (items: Partial<T>[]) => Promise<Partial<T>[]>,
  items: Partial<T>[],
) =>
  updateItems(
    items.map((v) => ({
      ...v,
      deletedAt2: null,
    })),
  );

const _deleteItemsWmdb = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  metrics: ApiMetrics,
  items: Partial<T>[],
  name = "deleteItemsWmdb",
) => {
  await database.write(async () => {
    const collection = database.get<W>(table);
    const records = await collection
      .query(
        Q.where(
          "id",
          Q.oneOf(items.map((item) => BigIntBase32.parse(item.id as string))),
        ),
      )
      .fetch();
    const preparedDeletes = records.map((record) =>
      record.prepareMarkAsDeleted(),
    );
    metrics.write.ops++;
    metrics.write.rows += items.length;
    return database.batch(...preparedDeletes);
  }, [table, name].join("."));
};

const _deleteItem = async <T extends BaseType>(
  deleteItems: (items: Partial<T>[]) => Promise<Partial<T>[]>,
  item: Partial<T>,
): Promise<Partial<T>> => (await deleteItems([item]))[0]!;

const _restoreItem = async <T extends BaseType>(
  restoreItems: (items: Partial<T>[]) => Promise<Partial<T>[]>,
  item: Partial<T>,
): Promise<Partial<T>> => (await restoreItems([item]))[0]!;

const _get = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  parse: ParseItem<Partial<T>>,
  metrics: ApiMetrics,
  filter?: ApiFilterObject<T>,
  options?: QueryOptions<StringKey<W>>,
): Promise<Partial<T>[] | undefined> => {
  const wmdbQueryConditions = filter
    ? buildQueryConditions({
        deletedAt: null,
        ...filter,
      } as ApiFilterObject<T>)
    : [];
  const enhancedQuery = buildWmdbQuery<W>(
    database,
    table,
    wmdbQueryConditions,
    options,
  );

  if (!enhancedQuery) return undefined;

  const rawItems = await enhancedQuery.fetch();
  metrics.read.ops++;
  metrics.read.rows += rawItems.length;
  return rawItems.map((v) => parse(v._raw));
};

const _count = async <W extends Model, T extends BaseType>(
  database: Database,
  table: TableName<W>,
  metrics: ApiMetrics,
  filter?: Partial<T>,
): Promise<number | undefined> => {
  const wmdbQueryConditions = filter
    ? buildQueryConditions({
        deletedAt: null,
        ...filter,
      } as ApiFilterObject<T>)
    : [];
  const enhancedQuery = buildWmdbQuery<W>(database, table, wmdbQueryConditions);
  if (!enhancedQuery) return undefined;
  metrics.read.ops++;
  return await enhancedQuery.fetchCount();
};

const filterToValues = <T,>(filter?: ApiFilterObject<T>): Partial<T> => {
  if (!filter) {
    return {};
  }
  const result: Partial<T> = {};
  for (const key in filter) {
    let value = filter[key as keyof T];
    if (Array.isArray(value)) {
      value = value[0];
    }
    if (value !== undefined && (typeof value !== "object" || value === null)) {
      result[key as keyof T] = value as any;
    }
  }
  return result;
};

export const useWatermelonLocal = <
  W extends Model,
  T extends BaseType,
  PK = Pick<T, "id">,
>(
  parse: ParseItem<Partial<T>>,
  usePreUpdate: (item?: Partial<T>) => ParseItem<Partial<T>> | undefined,
  allColumns: string[],
  table: TableName<W>,
  database: Database,
): BaseApiHooks<T, PK> => {
  const metricsR = useRef<ApiMetrics>({
    name: table,
    read: {
      ops: 0,
      rows: 0,
    },
    write: {
      ops: 0,
      rows: 0,
    },
  });
  const metrics = metricsR.current;

  type PT = Partial<T>;
  type K = StringKey<T>;
  assert(Array.isArray(allColumns), "useWatermelonLocalE1");
  const defaultGetColumns = allColumns.filter((v) => v !== "deletedAt") as K[];

  const CacheContext = createContext<T[] | undefined>(undefined);
  const FilterContext = createContext<ApiFilterObject<T> | undefined>(
    undefined,
  );

  const useFilterContext = (
    filter?: ApiFilterObject<T> | PT,
  ): ApiFilterObject<T> | undefined => {
    const filterContext = useContext(FilterContext);
    return useMemo(
      () => (filter ? { ...filterContext, ...filter } : undefined),
      [filterContext, filter],
    );
  };

  const warnTooManyItems = (
    v: any[] | undefined,
    filter: any,
    columns: string[],
    wmdbQuery?: Q.Where[],
  ) => _warnTooManyItems(table, v, filter, columns, wmdbQuery);

  const createItems = (items: PT[], name?: string) =>
    _createItems(database, table, parse, metrics, items, name);

  const createItem = (item: PT) => _createItem(createItems, item);

  const updateItem = (item: PT, name?: string) =>
    _updateItem(database, table, parse, metrics, createItem, item, name);

  const updateItems = (items: PT[]) => _updateItems(updateItem, items);

  const deleteItems = (items: PT[]) => _deleteItems(updateItems, items);

  const restoreItems = (items: PT[]) => _restoreItems(updateItems, items);

  const deleteItemsWmdb = (items: PT[], name?: string) =>
    _deleteItemsWmdb(database, table, metrics, items, name);

  const deleteItem = (item: PT) => _deleteItem(deleteItems, item);
  const restoreItem = (item: PT) => _restoreItem(restoreItems, item);

  const useGetList = (
    filter?: ApiFilterObject<T>,
    {
      columns = defaultGetColumns,
      ...options
    }: QueryOptions<K> & { columns?: StringKey<T>[] } = {},
  ): PT[] | undefined => {
    const filterMemo = useDeepMemo(useFilterContext(filter));
    const columnsMemo = useDeepMemo(columns);
    const optionsMemo = useDeepMemo(options);
    const wmdbQuery = useMemo(() => {
      if (filterMemo) {
        const isFetchingDeletedAtColumn = columnsMemo.includes(
          "deletedAt" as StringKey<T>,
        );
        const excludeDeletedItems = { deletedAt: null };
        const deletedItemFilter = isFetchingDeletedAtColumn
          ? {}
          : excludeDeletedItems;
        return buildQueryConditions({
          ...deletedItemFilter,
          ...filterMemo,
        } as ApiFilterObject<T>);
      }
    }, [filterMemo, columnsMemo]);
    const wmdbOptions = useMemo(
      () => ({ columns: columnsMemo, ...optionsMemo }) as any,
      [columnsMemo, optionsMemo],
    );
    assert(Array.isArray(columnsMemo), "useGetListE1");
    const cache = useContext(CacheContext);
    const useCache = cache !== undefined;

    const wmdbData = useWmdbQuery<W>(
      table,
      useCache ? undefined : wmdbQuery,
      wmdbOptions,
      metrics,
    );

    const fromCache = useMemo(() => {
      if (!useCache || cache === undefined) return undefined;
      const filtered = applyApiFilter(cache, filterMemo);
      return applyQueryOptions(filtered, optionsMemo);
    }, [useCache, cache, filterMemo, optionsMemo]);

    const fromWmdb = useMemoValue(
      (wmdbData, filter) => (
        warnTooManyItems(wmdbData, filter, columnsMemo, wmdbQuery),
        filter ? wmdbData?.map(parse) : undefined
      ),
      [wmdbData, filterMemo] as const,
    );
    return useCache ? fromCache : fromWmdb;
  };

  const useSetList = (filter?: PT) => {
    const preUpdate = usePreUpdate(filter);
    const mergedFilter = useDeepMemo(useFilterContext(filter));
    return useMemo(
      () =>
        preUpdate
          ? (items: PT[]) =>
              updateItems(
                items.map((v) =>
                  preUpdate({ ...v, ...filterToValues(mergedFilter) }),
                ),
              )
          : undefined,
      [preUpdate, mergedFilter],
    );
  };
  const useCreateList = (filter?: PT) => {
    const preUpdate = usePreUpdate();
    const mergedFilter = useDeepMemo(useFilterContext(filter));
    return useMemo(
      () =>
        preUpdate
          ? (items: PT[]) =>
              createItems(
                items.map((v) =>
                  preUpdate({ ...v, ...filterToValues(mergedFilter) }),
                ),
              )
          : undefined,
      [preUpdate, mergedFilter],
    );
  };
  const useUpdateList = () => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () =>
        preUpdate
          ? (items: PT[]) => updateItems(items.map(preUpdate))
          : undefined,
      [preUpdate],
    );
  };
  const useDeleteList = () => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () =>
        preUpdate
          ? (items: PT[]) => deleteItems(items.map(preUpdate))
          : undefined,
      [preUpdate],
    );
  };
  const useRestoreList = () => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () =>
        preUpdate
          ? (items: PT[]) => restoreItems(items.map(preUpdate))
          : undefined,
      [preUpdate],
    );
  };

  const useGetItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
  ): PT | null | undefined =>
    useMemoValue((v) => (v === undefined ? undefined : (v[0] ?? null)), [
      useGetList(filter, { columns }),
    ] as const);

  const useSetItem = (
    item: PT = {} as PT,
  ): AsyncDispatch<PT | null> | undefined => {
    const preUpdate = usePreUpdate(item);
    const { id, ...filter } = item;
    const mergedFilter = useDeepMemo(useFilterContext(filter as PT));
    return useMemo(
      () =>
        preUpdate
          ? async (v) => {
              const filterValues = filterToValues(mergedFilter);
              const next = await (typeof v === "function"
                ? v({ id, ...filterValues } as PT)
                : v);
              return next != null
                ? updateItem(parse(preUpdate({ id, ...next, ...filterValues })))
                : id
                  ? deleteItem(parse(preUpdate({ id } as PT)))
                  : null;
            }
          : undefined,
      [id, mergedFilter, preUpdate, parse, updateItem, deleteItem],
    );
  };

  const useCreateItem = (
    filter?: PT,
  ): ((item: Partial<T>) => Promise<Partial<T>>) | undefined => {
    const preUpdate = usePreUpdate();
    const filterMemo = useDeepMemo(useFilterContext(filter));
    return useMemo(
      () =>
        preUpdate
          ? (item: PT) =>
              createItem(
                parse(preUpdate({ ...item, ...filterToValues(filterMemo) })),
              )
          : undefined,
      [preUpdate, filterMemo, parse, createItem],
    );
  };
  const useUpdateItem = ():
    | (({ id, ...item }: Partial<T>) => Promise<Partial<T>>)
    | undefined => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () => (preUpdate ? (v) => updateItem(parse(preUpdate(v))) : undefined),
      [preUpdate, parse, updateItem],
    );
  };
  const useDeleteItem = ():
    | ((item: Partial<T>) => Promise<Partial<T>>)
    | undefined => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () => (preUpdate ? (v) => deleteItem(parse(preUpdate(v))) : undefined),
      [preUpdate, parse, deleteItem],
    );
  };
  const useRestoreItem = ():
    | ((item: Partial<T>) => Promise<Partial<T>>)
    | undefined => {
    const preUpdate = usePreUpdate();
    return useMemo(
      () => (preUpdate ? (v) => restoreItem(parse(preUpdate(v))) : undefined),
      [preUpdate, parse, restoreItem],
    );
  };

  const useItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
  ): AsyncState<PT | null> => {
    const getItem = useGetItem(filter, { columns });
    const setItem = useSetItem(getItem ?? filter);
    return useMemo(
      () => [
        getItem,
        setItem
          ? (
              getValue,
              newValue = typeof getValue === "function"
                ? getValue(getItem ?? null)
                : getValue,
            ) => setItem({ ...getItem, ...newValue } as Partial<T> | null)
          : undefined,
      ],
      [getItem, setItem],
    );
  };

  const useCount = (filter?: Partial<T>): number | undefined => {
    const cache = useContext(CacheContext);
    const useCache = cache !== undefined;
    const mergedFilter = useFilterContext(filter);
    const filterMemo = useDeepMemo(mergedFilter);

    const wmdbQuery = useMemo(() => {
      if (filterMemo) {
        const excludeDeletedItems = { deletedAt: null };
        return buildQueryConditions({
          ...excludeDeletedItems,
          ...filterMemo,
        } as ApiFilterObject<T>);
      }
    }, [filterMemo]);

    const fromWmdb = useWmdbCount<W>(
      table,
      useCache ? undefined : wmdbQuery,
      {},
      metrics,
    );

    const fromCache = useMemo(() => {
      if (!useCache || cache === undefined) return undefined;
      const excludeDeletedItems = { deletedAt: null };
      return applyApiFilter(cache, {
        ...excludeDeletedItems,
        ...filterMemo,
      } as ApiFilterObject<T>).length;
    }, [cache, filterMemo, useCache]);

    return useCache ? fromCache : fromWmdb;
  };

  const get = (
    filter?: ApiFilterObject<T>,
    options?: QueryOptions<StringKey<W>>,
  ) => _get(database, table, parse, metrics, filter, options);

  const count = (filter?: Partial<T>) =>
    _count(database, table, metrics, filter);

  const useList = (
    filter?: T,
    options?: QueryOptions<K> & { columns?: StringKey<T>[] },
  ): [
    items?: PT[],
    setItems?: (v: PT[]) => Promise<PT[]>,
    delItems?: (v: PT[]) => Promise<PT[]>,
  ] => {
    const items = useGetList(filter, options);
    const setItems = useSetList(filter);
    const delItems = useDeleteList();
    return [items, setItems, delItems];
  };

  const CacheProvider = ({
    filter,
    options,
    list = useGetList(filter, { ...options }) as T[] | undefined,
    children,
  }: {
    filter?: ApiFilterObject<T>;
    options?: QueryOptions<K> & { columns?: StringKey<T>[] };
    list?: T[];
    children: React.ReactNode;
  }) => <CacheContext.Provider value={list}>{children}</CacheContext.Provider>;

  const FilterProvider = ({
    filter,
    children,
  }: {
    filter: ApiFilterObject<T>;
    children: React.ReactNode;
  }) => {
    const mergedFilter = useFilterContext(filter);
    return (
      <FilterContext.Provider value={mergedFilter}>
        {children}
      </FilterContext.Provider>
    );
  };

  return {
    useGetList,
    useSetList,
    useCreateList,
    useUpdateList,
    useDeleteList,
    useRestoreList,
    useList,
    useGetItem,
    useSetItem,
    useCreateItem,
    useUpdateItem,
    useDeleteItem,
    useRestoreItem,
    useItem,
    useCount,
    get,
    count,
    CacheProvider,
    FilterProvider,
    metrics,
  } as any;
};
