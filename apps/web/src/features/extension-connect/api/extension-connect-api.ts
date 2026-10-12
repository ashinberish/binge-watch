import { useMutation } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api'

/** Creates a single-use code the extension exchanges for its own session. */
export function useCreateExtensionCode() {
  return useMutation({
    mutationFn: async (redirectUri: string) =>
      unwrap(
        await api.POST('/api/v1/auth/extension-code', { body: { redirect_uri: redirectUri } }),
      ),
  })
}
