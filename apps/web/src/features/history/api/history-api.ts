import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap, type ContinueWatchingItem, type ProfileId } from '@/lib/api'

export const continueWatchingQueryOptions = (profileId: ProfileId) =>
  queryOptions({
    queryKey: ['history', 'continue-watching', profileId] as const,
    queryFn: async (): Promise<ContinueWatchingItem[]> =>
      unwrap(
        await api.GET('/api/v1/history/continue-watching', {
          params: { query: { profile_id: profileId } },
        }),
      ),
  })

export function useContinueWatching(profileId: ProfileId | null) {
  return useQuery({
    ...continueWatchingQueryOptions(profileId as ProfileId),
    enabled: profileId != null,
  })
}
