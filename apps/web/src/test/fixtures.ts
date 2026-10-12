// Contract-shaped fixtures. Kept untyped against the generated schema on purpose so
// tests also document the wire format.
export const API = 'http://api.test/api/v1'

export const user = {
  id: 'u_1',
  email: 'kai@example.com',
  display_name: 'Kai',
  created_at: '2026-01-01T00:00:00Z',
}

export const tokenPair = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  token_type: 'bearer' as const,
  expires_in: 900,
}

export const profiles = [
  {
    id: 'p_1',
    name: 'Kai',
    avatar_color: '#d32f23',
    is_kids: false,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'p_2',
    name: 'Mo Reyes',
    avatar_color: '#5aa9ff',
    is_kids: true,
    created_at: '2026-01-02T00:00:00Z',
  },
]

export const continueWatching = [
  {
    episode_id: 'e_1',
    show_id: 's_1',
    show_title: 'Night Shift',
    poster_url: null,
    season_number: 2,
    episode_number: 5,
    episode_title: 'Lights out',
    position_seconds: 1800,
    duration_seconds: 2880,
    updated_at: '2026-10-11T21:00:00Z',
  },
  {
    episode_id: 'e_2',
    show_id: 's_2',
    show_title: 'Harbour Lights',
    poster_url: 'https://img.example.com/harbour.jpg',
    season_number: 1,
    episode_number: 2,
    episode_title: 'Low tide',
    position_seconds: 300,
    duration_seconds: 3000,
    updated_at: '2026-10-10T21:00:00Z',
  },
]

export const streak = { current_days: 4, longest_days: 9, episodes_today: 5 }

export const problem = (status: number, title: string, detail?: string) => ({
  type: 'about:blank',
  title,
  status,
  detail,
  instance: '/api/v1',
})
