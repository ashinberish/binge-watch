import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '@/stores/ui'
import { login, logout, meQueryKey, meQueryOptions, register } from '../api/auth-api'
import type { LoginValues, RegisterValues } from '../schemas'
import { getRefreshToken, useSession } from '../session'

export function useMe() {
  const signedIn = useSession((s) => s.accessToken !== null)
  return useQuery({ ...meQueryOptions(), enabled: signedIn })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: login,
    onSuccess: (pair) => {
      useSession.getState().setTokens(pair)
      void queryClient.invalidateQueries({ queryKey: meQueryKey })
    },
  })
}

/** Creates the account, then signs in with the same credentials. */
export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: RegisterValues) => {
      const user = await register(values)
      const pair = await login({
        email: values.email,
        password: values.password,
      } satisfies LoginValues)
      return { user, pair }
    },
    onSuccess: ({ user, pair }) => {
      useSession.getState().setTokens(pair)
      queryClient.setQueryData(meQueryKey, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const refreshToken = getRefreshToken()
      // Revoking is best effort; the local session is cleared regardless.
      if (refreshToken) await logout(refreshToken).catch(() => undefined)
    },
    onSettled: () => {
      useSession.getState().clear()
      useUiStore.getState().reset()
      queryClient.clear()
    },
  })
}
