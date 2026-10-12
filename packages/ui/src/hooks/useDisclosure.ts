import { useCallback, useState } from 'react'

export interface Disclosure {
  open: boolean
  onOpen: () => void
  onClose: () => void
  onToggle: () => void
  setOpen: (open: boolean) => void
}

/** Open/close state for dialogs, menus and drawers. */
export function useDisclosure(initial = false): Disclosure {
  const [open, setOpen] = useState(initial)
  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])
  const onToggle = useCallback(() => setOpen((v) => !v), [])
  return { open, onOpen, onClose, onToggle, setOpen }
}
