// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import {
  ApiFilterObject,
  ApiRecord,
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
import { useMemo } from "react";
import { buildWmdbQuery, useWmdbCount, useWmdbQuery } from "./useWmdbQuery.js";

export type ConvertItem<A, D> = (v: A) => D;
export type AssertItem<T> = ConvertItem<T, T>;
export type ParseItem<T> = ConvertItem<any, T>;

export const useWatermelonLocal = <
  W extends Model,
  T extends {
    id: string;
    updatedAt: number;
    createdAt: number;
    deletedAt: number | null;
  },
  PK = Pick<T, "id">,
>(
  parse: ParseItem<Partial<T>>,
  usePreUpdate: () => ParseItem<Partial<T>>,
  allColumns: string[],
  table: TableName<W>,
  database: Database,
): BaseApiHooks<T, PK> => {
  type PT = Partial<T>;
  type K = StringKey<T>;
  assert(Array.isArray(allColumns), "useWatermelonLocalE1");
  const defaultGetColumns = allColumns.filter((v) => v !== "deletedAt") as K[];

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

  const buildQueryConditions = <T extends ApiRecord>(
    filter?: ApiFilterObject<T>,
  ): Q.Where[] => {
    const conditions: Q.Where[] = [];
    if (filter) {
      for (const [k, rawValue] of Object.entries(dropUndefined(filter))) {
        const key = k as StringKey<T>;
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const orConditions: Q.Where[] = [];

        if (values.length === 0) {
          // There are no possible values for this key
          conditions.push(Q.where("id", Q.eq(null)));
          break; // Exit the loop after adding the impossible condition
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

  const warnTooManyItems = (
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
  ): PT[] | undefined => (
    assert(Array.isArray(columnsMemo), "useGetListE1"),
    useMemoValue(
      (v, filter) => (
        warnTooManyItems(v, filter, columnsMemo, wmdbQuery),
        filter ? v?.map(parse) : undefined
      ),
      [useWmdbQuery<W>(table, wmdbQuery, wmdbOptions), filterMemo] as const,
    )
  );

  const useSetList =
    (filter?: PT, preUpdate = usePreUpdate()) =>
    (items: PT[]) =>
      updateItems(
        items.map((v) => preUpdate({ ...v, ...dropUndefined(filter ?? {}) })),
      );
  const useCreateList =
    (filter?: PT, preUpdate = usePreUpdate()) =>
    (items: PT[]) =>
      createItems(
        items.map((v) => preUpdate({ ...v, ...dropUndefined(filter ?? {}) })),
      );
  const useUpdateList =
    (preUpdate = usePreUpdate()) =>
    (items: PT[]) =>
      updateItems(items.map(preUpdate));
  const useDeleteList =
    (preUpdate = usePreUpdate()) =>
    (items: PT[]) =>
      deleteItems(items.map(preUpdate));
  const useRestoreList =
    (preUpdate = usePreUpdate()) =>
    (items: PT[]) =>
      restoreItems(items.map(preUpdate));

  const useItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
    getItem = useGetItem(filter, { columns }),
    setItem = useSetItem(filter),
  ): AsyncState<PT | null> => [
    getItem,
    setItem
      ? (
          getValue,
          newValue = typeof getValue === "function"
            ? getValue(getItem ?? null)
            : getValue,
        ) => setItem({ ...getItem, ...newValue } as Partial<T> | null)
      : undefined,
  ];

  const useGetItem = (
    filter?: T,
    { columns = defaultGetColumns } = {},
  ): PT | null | undefined =>
    useMemoValue((v) => (v === undefined ? undefined : (v[0] ?? null)), [
      useGetList(filter, { columns }),
    ] as const);

  const createItem = async (item: PT): Promise<PT> =>
    (await createItems([item]))[0]!;
  // const updateItem = async (item: PT) => (await updateItems([item]))[0];
  const deleteItem = async (item: PT): Promise<PT> =>
    (await deleteItems([item]))[0]!;
  const restoreItem = async (item: PT): Promise<PT> =>
    (await restoreItems([item]))[0]!;

  const useSetItem =
    (
      { id, ...filter }: PT = {} as PT,
      preUpdate = usePreUpdate(),
    ): AsyncDispatch<PT | null> | undefined =>
    async (v) => {
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
    };

  const deleteItemWmdbSingle = async (item: PT) =>
    (await deleteItemsWmdb([item]))[0];

  const useCreateItem =
    (filter?: PT, preUpdate = usePreUpdate()) =>
    (item: PT) =>
      createItem(parse(preUpdate({ ...item, ...dropUndefined(filter ?? {}) })));
  const useUpdateItem =
    (
      preUpdate = usePreUpdate(),
    ): (({ id, ...item }: Partial<T>) => Promise<Partial<T>>) =>
    (v) =>
      updateItem(parse(preUpdate(v)));
  const useDeleteItem =
    (preUpdate = usePreUpdate()): ((item: Partial<T>) => Promise<Partial<T>>) =>
    (v) =>
      deleteItem(parse(preUpdate(v)));
  const useRestoreItem =
    (preUpdate = usePreUpdate()): ((item: Partial<T>) => Promise<Partial<T>>) =>
    (v) =>
      restoreItem(parse(preUpdate(v)));

  const createItems = async (items: PT[]): Promise<PT[]> => {
    let created: PT[] = [];
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
      return database.batch(...preparedCreates);
    });
    return created;
  };

  const updateItem = async ({ id, ...item }: PT): Promise<Partial<T>> =>
    id == null
      ? createItem(item as Partial<T>)
      : parse(
          await database.write(() =>
            database
              .get<W>(table)
              .find(BigIntBase32.parse(id))
              .then((r) =>
                r.update(
                  (v) => (
                    mergeObject(v, {
                      updatedAt2: getUnixTimestamp(),
                      ...item,
                    }),
                    v
                  ),
                ),
              ),
          ),
        );

  const updateItems = async (items: PT[]) => {
    const updated: PT[] = [];
    for (const item of items) {
      updated.push(await updateItem(item));
    }
    return updated;
  };

  // error - cant use async await inside database.write()
  const updateItemsWmdb = async (items: PT[]) => {
    let created: PT[] = [];
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
      return database.batch(...preparedUpdates);
    });
    return created;
  };

  const deleteItems = async (items: PT[]) =>
    updateItems(
      items.map((v) => ({
        ...v,
        deletedAt2: getUnixTimestamp(),
      })),
    );

  const restoreItems = async (items: PT[]) =>
    updateItems(
      items.map((v) => ({
        ...v,
        deletedAt2: null,
      })),
    );

  const deleteItemsWmdb = async (items: PT[]) => {
    return await database.write(async () => {
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
      return database.batch(...preparedDeletes);
    });
  };

  const useCount = (filter?: Partial<T>): number | undefined => {
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

    return useWmdbCount<W>(table, wmdbQuery);
  };

  const get = async (
    filter?: ApiFilterObject<T>,
    options?: QueryOptions<StringKey<W>>,
  ): Promise<PT[] | undefined> => {
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
    return rawItems.map(parse);
  };

  const count = async (filter?: Partial<T>): Promise<number | undefined> => {
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
    );
    if (!enhancedQuery) return undefined;
    return enhancedQuery.fetchCount();
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
  } as any;
};
