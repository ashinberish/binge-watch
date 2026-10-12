import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type ProfileCreate, type ProfileRead } from '@/lib/api'

export const profilesQueryKey = ['profiles'] as const

export const profilesQueryOptions = () =>
  queryOptions({
    queryKey: profilesQueryKey,
    queryFn: async (): Promise<ProfileRead[]> => unwrap(await api.GET('/api/v1/profiles')),
  })

export function useProfiles() {
  return useQuery(profilesQueryOptions())
}

export function useCreateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: ProfileCreate): Promise<ProfileRead> =>
      unwrap(await api.POST('/api/v1/profiles', { body })),
    onSuccess: (created) => {
      queryClient.setQueryData<ProfileRead[]>(profilesQueryKey, (old) => [...(old ?? []), created])
      void queryClient.invalidateQueries({ queryKey: profilesQueryKey })
    },
  })
}
