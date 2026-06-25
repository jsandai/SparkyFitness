import { useMemo, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { searchExternalFoods } from '../services/api/externalFoodSearchApi';
import { allProvidersFoodSearchQueryKey } from './queryKeys';
import { useDebounce } from './useDebounce';
import { RateLimiter } from '../utils/rateLimiter';
import { ExternalProvider } from '../types/externalProviders';
import { ExternalFoodItem } from '../types/externalFoods';

// Open Food Facts allows 10 req/min; use 8 for headroom. Separate instance from
// the single-provider hook's limiter, but the two modes are mutually exclusive
// (the single-provider search is disabled while "All Providers" is active).
const offRateLimiter = new RateLimiter(8, 60_000);

// Stable fallback so a missing refetch does not allocate a new function each
// render (which would break reference stability of the providerResults items).
const noop = () => {};

export interface ProviderSearchResult {
  provider: ExternalProvider;
  items: ExternalFoodItem[];
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

// Fans a single search out across every active food provider in parallel. Each
// provider query is independent, so results stream in as they return and a
// failure in one provider does not block the others (partial results). First
// page only; "show all" deep-links to the single-provider search for full
// pagination.
export function useAllProvidersSearch(
  searchText: string,
  providers: ExternalProvider[],
  options?: { enabled?: boolean; autoScale?: boolean },
) {
  const { enabled = true, autoScale } = options ?? {};
  const debouncedSearch = useDebounce(searchText.trim(), 600);
  const isSearchActive = debouncedSearch.length >= 3;

  const queries = useQueries({
    queries: providers.map((p) => ({
      queryKey: allProvidersFoodSearchQueryKey(
        p.provider_type,
        debouncedSearch,
        p.id,
        autoScale,
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (p.provider_type === 'openfoodfacts') {
          await offRateLimiter.acquire(signal);
        }
        return searchExternalFoods(
          p.provider_type,
          debouncedSearch,
          1,
          p.id,
          autoScale,
        );
      },
      enabled: isSearchActive && enabled,
      staleTime: 1000 * 60 * 5,
    })),
  });

  // useQueries returns a new array reference every render, which would make
  // providerResults (and the screen's resultSections) recompute on every
  // keystroke. Only adopt the new reference when a query's data, loading, or
  // error state actually changed, so the list does not re-render while typing.
  const queriesRef = useRef(queries);
  const providersRef = useRef(providers);
  const stableQueries = useMemo(() => {
    const prevQueries = queriesRef.current;
    const prevProviders = providersRef.current;
    // Also invalidate when the providers list changes (added, removed, or
    // reordered) so a query is never paired with the wrong provider just
    // because two queries happened to share the same loading/error/data state.
    const providersChanged =
      providers.length !== prevProviders.length ||
      providers.some((p, i) => p.id !== prevProviders[i]?.id);
    const queriesChanged =
      queries.length !== prevQueries.length ||
      queries.some((q, i) => {
        const p = prevQueries[i];
        return (
          q?.data !== p?.data ||
          q?.isFetching !== p?.isFetching ||
          q?.isError !== p?.isError
        );
      });
    if (providersChanged || queriesChanged) {
      queriesRef.current = queries;
      providersRef.current = providers;
      return queries;
    }
    return prevQueries;
  }, [queries, providers]);

  const providerResults = useMemo<ProviderSearchResult[]>(
    () =>
      providers.map((provider, i) => {
        const q = stableQueries[i];
        const items = q?.data?.items ?? [];
        return {
          provider,
          items,
          totalCount: q?.data?.pagination?.totalCount ?? 0,
          // Loading while fetching with nothing to show yet — covers the initial
          // load and an error retry (isLoading is false on a retry), but not a
          // background refetch that already has cached results (which would
          // otherwise flash the spinner over good data).
          isLoading: (q?.isFetching ?? false) && items.length === 0,
          isError: q?.isError ?? false,
          refetch: q?.refetch ?? noop,
        };
      }),
    [providers, stableQueries],
  );

  const anyLoading = providerResults.some((r) => r.isLoading);

  return { providerResults, isSearchActive, anyLoading };
}
