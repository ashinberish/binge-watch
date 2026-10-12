import type { Theme } from '@nightreel/ui'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ProfileId } from '@/lib/api'

interface UiState {
  /** Profile chosen on "Who's watching?". Scopes history and streak queries. */
  activeProfileId: ProfileId | null
  /** Preferred theme, applied to every page. */
  theme: Theme
  setActiveProfile: (id: ProfileId | null) => void
  setTheme: (theme: Theme) => void
  reset: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      theme: 'dark',
      setActiveProfile: (activeProfileId) => set({ activeProfileId }),
      setTheme: (theme) => set({ theme }),
      reset: () => set({ activeProfileId: null }),
    }),
    {
      name: 'nightreel.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ activeProfileId, theme }) => ({ activeProfileId, theme }),
    },
  ),
)
