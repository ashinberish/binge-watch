import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { api, unwrap, type PartyRead } from '@/lib/api'

export const partyQueryOptions = (code: string) =>
  queryOptions({
    queryKey: ['parties', code] as const,
    queryFn: async (): Promise<PartyRead> =>
      unwrap(await api.GET('/api/v1/parties/{code}', { params: { path: { code } } })),
    // An invite is looked at once; the join call re-checks it anyway.
    refetchOnWindowFocus: false,
  })

/** The party behind an invite link. 404 when it ended, expired or never existed. */
export function useParty(code: string) {
  return useQuery(partyQueryOptions(code))
}

/** Joins the party (idempotent). 409 when it is full. */
export function useJoinParty() {
  return useMutation({
    mutationFn: async (code: string): Promise<PartyRead> =>
      unwrap(await api.POST('/api/v1/parties/{code}/join', { params: { path: { code } } })),
  })
}
