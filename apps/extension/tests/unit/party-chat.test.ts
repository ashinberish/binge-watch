import { describe, expect, it } from 'vitest'

import {
  addChatMessage,
  addSystemLine,
  chatEntries,
  chatInputState,
  cleanChatText,
  emptyChatLog,
  markChatRead,
  mergeChatHistory,
  relativeTime,
  SYSTEM_LINE_LIMIT,
  truncate,
  type ChatLog,
} from '../../src/party/chat'
import type { ChatMessage } from '../../src/party/protocol'
import { createToastQueue, toastText } from '../../src/party/toasts'

const sam = { id: 'u2', display_name: 'Sam' }
const kai = { id: 'u1', display_name: 'Kai' }
const msg = (id: string, user = sam, sentAt = 1_000, text = 'that ending'): ChatMessage => ({
  id,
  user,
  text,
  sent_at: sentAt,
})

const others = { selfId: 'u1', reading: false }

describe('chat log', () => {
  it('keeps the last 50 messages, like the server', () => {
    let log: ChatLog = emptyChatLog()
    for (let i = 0; i < 60; i += 1) log = addChatMessage(log, msg(`m${i}`), others).log
    expect(log.messages).toHaveLength(50)
    expect(log.messages[0]?.id).toBe('m10')
    expect(log.messages.at(-1)?.id).toBe('m59')
  })

  it('ignores a message it already has', () => {
    const first = addChatMessage(emptyChatLog(), msg('m1'), others)
    const again = addChatMessage(first.log, msg('m1'), others)
    expect(again.added).toBe(false)
    expect(again.log).toBe(first.log)
    expect(again.log.unread).toBe(1)
  })

  it('counts unread messages from others only, while nobody is reading', () => {
    let log = emptyChatLog()
    log = addChatMessage(log, msg('m1'), others).log
    log = addChatMessage(log, msg('m2', kai), others).log // your own
    log = addChatMessage(log, msg('m3'), { selfId: 'u1', reading: true }).log // read on arrival
    log = addChatMessage(log, msg('m4'), others).log
    expect(log.unread).toBe(2)
    log = markChatRead(log)
    expect(log.unread).toBe(0)
    expect(log.messages).toHaveLength(4)
    expect(markChatRead(log)).toBe(log)
  })

  it('merges a reconnect’s history without duplicates, in send order', () => {
    let log = emptyChatLog()
    log = addChatMessage(log, msg('m2', sam, 1_002), others).log
    const merged = mergeChatHistory(log, [msg('m1', sam, 1_001), msg('m2', sam, 1_002)])
    expect(merged.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(merged.unread).toBe(1)
    const many = Array.from({ length: 70 }, (_, i) => msg(`h${i}`, sam, i))
    expect(mergeChatHistory(emptyChatLog(), many).messages).toHaveLength(50)
  })
})

describe('chat input', () => {
  it('needs something other than whitespace', () => {
    expect(chatInputState('').canSend).toBe(false)
    expect(chatInputState('   ').canSend).toBe(false)
    expect(chatInputState(' hi ').canSend).toBe(true)
  })

  it('shows a counter only near the 500 character limit', () => {
    expect(chatInputState('a'.repeat(449))).toMatchObject({
      showCounter: false,
      counterText: null,
    })
    expect(chatInputState('a'.repeat(450))).toMatchObject({
      showCounter: true,
      counterText: '50 characters left',
      canSend: true,
    })
    expect(chatInputState('a'.repeat(499)).counterText).toBe('1 character left')
    expect(chatInputState('a'.repeat(500))).toMatchObject({
      remaining: 0,
      canSend: true,
      tooLong: false,
    })
    expect(chatInputState('a'.repeat(503))).toMatchObject({
      tooLong: true,
      canSend: false,
      counterText: '3 characters over the limit',
    })
  })

  it('cleans what goes to the service worker', () => {
    expect(cleanChatText('  hello  ')).toBe('hello')
    expect(cleanChatText('')).toBeNull()
    expect(cleanChatText('\n\t ')).toBeNull()
    expect(cleanChatText(42)).toBeNull()
    expect(cleanChatText('a'.repeat(500))).toHaveLength(500)
    expect(cleanChatText('a'.repeat(501))).toBeNull()
  })
})

describe('chat formatting', () => {
  it('says how long ago a message was sent', () => {
    const now = 1_000_000
    expect(relativeTime(1_000, now)).toBe('now')
    expect(relativeTime(1_000 - 59, now)).toBe('now')
    expect(relativeTime(1_000 - 60, now)).toBe('1 min ago')
    expect(relativeTime(1_000 - 3_600 * 2, now)).toBe('2 h ago')
    expect(relativeTime(1_000 - 86_400 * 3, now)).toBe('3 d ago')
    // A server clock slightly ahead never reads as the future.
    expect(relativeTime(1_005, now)).toBe('now')
  })

  it('truncates on whole characters', () => {
    expect(truncate('short', 80)).toBe('short')
    expect(truncate('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(truncate('one\n\ntwo', 80)).toBe('one two')
  })
})

describe('chat bubbles over the player', () => {
  it('reads "Name: text", cut to 80 characters', () => {
    expect(toastText(msg('m1'))).toBe('Sam: that ending')
    const long = toastText(msg('m2', sam, 1, 'x'.repeat(200)))
    expect(Array.from(long)).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('shows one bubble for 4 s at a time and queues the rest', () => {
    let now = 0
    const toasts = createToastQueue({ now: () => now })
    toasts.push(msg('m1'))
    toasts.push(msg('m2', kai, 1, 'same here'))
    toasts.push(msg('m1')) // duplicate
    expect(toasts.current?.text).toBe('Sam: that ending')
    now = 3_999
    expect(toasts.advance()).toBe(false)
    now = 4_000
    expect(toasts.current).toBeNull()
    expect(toasts.advance()).toBe(true)
    expect(toasts.current?.text).toBe('Kai: same here')
    now = 8_000
    toasts.advance()
    expect(toasts.current).toBeNull()
  })

  it('drops the oldest waiting bubbles when chat is busy', () => {
    const toasts = createToastQueue({ now: () => 0, maxQueued: 2 })
    for (let i = 0; i < 6; i += 1) toasts.push(msg(`m${i}`, sam, 1, `n${i}`))
    expect(toasts.current?.text).toBe('Sam: n0')
    toasts.clear()
    expect(toasts.current).toBeNull()
  })
})

describe('chat entries', () => {
  const line = (id: string, at: number) => ({ id, text: 'Sam switched to a new video', at })

  it('groups one sender’s messages within two minutes under one head', () => {
    const entries = chatEntries(
      [
        msg('a', sam, 1_000),
        msg('b', sam, 1_060),
        msg('c', sam, 1_200), // 140 s after the previous one
        msg('d', kai, 1_210),
        msg('e', kai, 1_220),
      ],
      [],
      'u1',
    )
    expect(
      entries.map((e) => (e.kind === 'message' ? `${e.message.id}:${e.head}:${e.own}` : e.kind)),
    ).toEqual(['a:true:false', 'b:false:false', 'c:true:false', 'd:true:true', 'e:false:true'])
  })

  it('puts system lines in time order, and they break a group', () => {
    const entries = chatEntries(
      [msg('a', sam, 1_000), msg('b', sam, 1_030)],
      [line('video-4', 1_010)],
      'u1',
    )
    expect(
      entries.map((e) => (e.kind === 'message' ? `${e.message.id}:${e.head}` : e.line.id)),
    ).toEqual(['a:true', 'video-4', 'b:true'])
  })

  it('adds system lines once each and keeps the newest', () => {
    let lines = addSystemLine([], line('x', 1))
    expect(addSystemLine(lines, line('x', 2))).toBe(lines)
    for (let i = 0; i < 30; i += 1) lines = addSystemLine(lines, line(`l${i}`, i))
    expect(lines).toHaveLength(SYSTEM_LINE_LIMIT)
    expect(lines.at(-1)?.id).toBe('l29')
  })
})
