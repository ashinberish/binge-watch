import { beforeEach } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'

// The source uses the `chrome` global; WXT's in-memory fake implements the same
// storage, runtime and tabs APIs.
;(globalThis as unknown as { chrome: unknown }).chrome = fakeBrowser

beforeEach(() => {
  fakeBrowser.reset()
})
