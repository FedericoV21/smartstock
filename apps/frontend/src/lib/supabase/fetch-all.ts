type QueryError = { message: string };

type QueryResult<T> = {
  data: T[] | null;
  error: QueryError | null;
};

type RangeableQuery<T> = PromiseLike<QueryResult<T>> & {
  range(from: number, to: number): PromiseLike<QueryResult<T>>;
};

export async function fetchAllRows<T>(
  buildQuery: () => RangeableQuery<T>,
  pageSize = 1000,
): Promise<{ data: T[]; error: QueryError | null }> {
  const all: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: [], error };

    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }

  return { data: all, error: null };
}
