import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, unwrap, type ProfileId, type StreakRead } from '@/lib/api'

export const streakQueryOptions = (profileId: ProfileId) =>
  queryOptions({
    queryKey: ['streaks', 'current', profileId] as const,
    queryFn: async (): Promise<StreakRead> =>
      unwrap(
        await api.GET('/api/v1/streaks/current', { params: { query: { profile_id: profileId } } }),
      ),
  })

export function useStreak(profileId: ProfileId | null) {
  return useQuery({ ...streakQueryOptions(profileId as ProfileId), enabled: profileId != null })
}
