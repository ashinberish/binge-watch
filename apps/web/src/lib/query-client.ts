import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './problem'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Client errors (bad request, not found, unauthorized) won't fix themselves.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
