import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type UserRead } from '@/lib/api'

const meQueryKey = ['me'] as const

export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { display_name: string }): Promise<UserRead> =>
      unwrap(await api.PATCH('/api/v1/users/me', { body })),
    onSuccess: (user) => queryClient.setQueryData(meQueryKey, user),
  })
}
