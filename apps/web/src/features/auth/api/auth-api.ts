import { queryOptions } from '@tanstack/react-query'
import { api, unwrap, type TokenPair, type UserRead } from '@/lib/api'
import type { LoginValues, RegisterValues } from '../schemas'

export const meQueryKey = ['me'] as const

export const meQueryOptions = () =>
  queryOptions({
    queryKey: meQueryKey,
    queryFn: async (): Promise<UserRead> => unwrap(await api.GET('/api/v1/users/me')),
  })

export async function login(values: LoginValues): Promise<TokenPair> {
  return unwrap(await api.POST('/api/v1/auth/login', { body: values }))
}

export async function register(values: RegisterValues): Promise<UserRead> {
  return unwrap(await api.POST('/api/v1/auth/register', { body: values }))
}

export async function logout(refreshToken: string): Promise<void> {
  await api.POST('/api/v1/auth/logout', { body: { refresh_token: refreshToken } })
}
