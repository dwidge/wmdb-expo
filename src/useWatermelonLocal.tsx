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
import { dropUndefined, mergeObject } from "@dwidge/utils-js";
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

export const useWatermelonLocal = <
  W extends Model,
  T extends BaseType,
  PK = Pick<T, "id">,
>(
  parse: ParseItem<Partial<T>>,
  usePreUpdate: () => ParseItem<Partial<T>>,
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
    filterMemo = useDeepMemo(filter),
    columnsMemo = useDeepMemo(columns),
    optionsMemo = useDeepMemo(options),
    wmdbQuery = useMemo(() => {
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
    }, [filterMemo, columnsMemo]),
    wmdbOptions = useMemo(
      () => ({ columns: columnsMemo, ...optionsMemo }) as any,
      [columnsMemo, optionsMemo],
    ),
  ): PT[] | undefined => {
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

  const useSetList = (filter?: PT, preUpdate = usePreUpdate()) =>
    useMemo(
      () => (items: PT[]) =>
        updateItems(
          items.map((v) => preUpdate({ ...v, ...dropUndefined(filter ?? {}) })),
        ),
      [preUpdate, filter],
    );
  const useCreateList = (filter?: PT, preUpdate = usePreUpdate()) =>
    useMemo(
      () => (items: PT[]) =>
        createItems(
          items.map((v) => preUpdate({ ...v, ...dropUndefined(filter ?? {}) })),
        ),
      [preUpdate, filter],
    );
  const useUpdateList = (preUpdate = usePreUpdate()) =>
    useMemo(
      () => (items: PT[]) => updateItems(items.map(preUpdate)),
      [preUpdate],
    );
  const useDeleteList = (preUpdate = usePreUpdate()) =>
    useMemo(
      () => (items: PT[]) => deleteItems(items.map(preUpdate)),
      [preUpdate],
    );
  const useRestoreList = (preUpdate = usePreUpdate()) =>
    useMemo(
      () => (items: PT[]) => restoreItems(items.map(preUpdate)),
      [preUpdate],
    );

  const useGetItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
  ): PT | null | undefined =>
    useMemoValue((v) => (v === undefined ? undefined : (v[0] ?? null)), [
      useGetList(filter, { columns }),
    ] as const);

  const useSetItem = (
    { id, ...filter }: PT = {} as PT,
    preUpdate = usePreUpdate(),
  ): AsyncDispatch<PT | null> | undefined =>
    useMemo(
      () => async (v) => {
        const next = await (typeof v === "function"
          ? v({ id, ...dropUndefined(filter) } as PT)
          : v);
        return next != null
          ? updateItem(
              parse(preUpdate({ id, ...next, ...dropUndefined(filter) })),
            )
          : id
            ? deleteItem(parse(preUpdate({ id } as PT)))
            : null;
      },
      [id, filter, preUpdate, parse, updateItem, deleteItem],
    );

  const useCreateItem = (
    filter?: PT,
    preUpdate = usePreUpdate(),
    filterMemo = useDeepMemo(filter),
  ): ((item: Partial<T>) => Promise<Partial<T>>) =>
    useMemo(
      () => (item: PT) =>
        createItem(
          parse(preUpdate({ ...item, ...dropUndefined(filterMemo ?? {}) })),
        ),
      [preUpdate, filterMemo, parse, createItem],
    );
  const useUpdateItem = (
    preUpdate = usePreUpdate(),
  ): (({ id, ...item }: Partial<T>) => Promise<Partial<T>>) =>
    useMemo(
      () => (v) => updateItem(parse(preUpdate(v))),
      [preUpdate, parse, updateItem],
    );
  const useDeleteItem = (
    preUpdate = usePreUpdate(),
  ): ((item: Partial<T>) => Promise<Partial<T>>) =>
    useMemo(
      () => (v) => deleteItem(parse(preUpdate(v))),
      [preUpdate, parse, deleteItem],
    );
  const useRestoreItem = (
    preUpdate = usePreUpdate(),
  ): ((item: Partial<T>) => Promise<Partial<T>>) =>
    useMemo(
      () => (v) => restoreItem(parse(preUpdate(v))),
      [preUpdate, parse, restoreItem],
    );

  const useItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
    getItem = useGetItem(filter, { columns }),
    setItem = useSetItem(filter),
  ): AsyncState<PT | null> =>
    useMemo(
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

  const useCount = (filter?: Partial<T>): number | undefined => {
    const cache = useContext(CacheContext);
    const useCache = cache !== undefined;
    const filterMemo = useDeepMemo(filter);

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
    items = useGetList(filter, options),
    setItems = useSetList(filter),
    delItems = useDeleteList(),
  ): [
    items?: PT[],
    setItems?: (v: PT[]) => Promise<PT[]>,
    delItems?: (v: PT[]) => Promise<PT[]>,
  ] => [items, setItems, delItems];

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
    metrics,
  } as any;
};
