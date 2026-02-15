/**
 * Session view
 * Attached session with output display and input
 */

import { createSignal, createEffect, Show, onCleanup, createMemo } from "solid-js"
import { TextAttributes, InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSessions } from "@tui/component/dialog-sessions"
import { useCommandDialog } from "@tui/component/dialog-command"
import { getSessionManager } from "@/core/session"
import type { Session as SessionType, SessionStatus } from "@/core/types"
import { SessionHeader } from "./header"
import { SessionFooter } from "./footer"

export function Session() {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const command = useCommandDialog()
  const manager = getSessionManager()

  const sessionId = createMemo(() => {
    if (route.data.type === "session") {
      return route.data.sessionId
    }
    return ""
  })

  const session = createMemo<SessionType | undefined>(() => {
    return sync.session.get(sessionId())
  })

  const [output, setOutput] = createSignal("")
  const [inputValue, setInputValue] = createSignal("")

  let inputRef: InputRenderable
  let scrollRef: ScrollBoxRenderable

  // Fetch output periodically
  createEffect(() => {
    const id = sessionId()
    if (!id) return

    async function fetchOutput() {
      try {
        const text = await manager.getOutput(id, 100)
        setOutput(text)
      } catch {
        // Session might not exist
      }
    }

    fetchOutput()
    const interval = setInterval(fetchOutput, 500)

    onCleanup(() => clearInterval(interval))
  })

  // Auto-scroll to bottom when output changes
  createEffect(() => {
    output()
    if (scrollRef) {
      // Scroll to the bottom
      scrollRef.scrollTo(scrollRef.scrollHeight || 0)
    }
  })

  async function sendMessage() {
    const value = inputValue().trim()
    if (!value) return

    try {
      await manager.sendMessage(sessionId(), value)
      setInputValue("")
      inputRef?.focus()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  // Keyboard shortcuts
  useKeyboard((evt) => {
    if (evt.name === "q" && !inputRef?.focused) {
      route.navigate({ type: "home" })
    }
    if (evt.name === "l" && evt.ctrl) {
      dialog.replace(() => <DialogSessions />)
    }
    if (evt.name === "k" && evt.ctrl) {
      command.open()
    }
    if (evt.name === "escape") {
      inputRef?.blur()
    }
  })

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      <Show
        when={session()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.textMuted}>Session not found</text>
          </box>
        }
      >
        {(s: () => SessionType) => (
          <>
            {/* Header */}
            <SessionHeader session={s()} />

            {/* Output area */}
            <box flexGrow={1} padding={1}>
              <scrollbox
                ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
                flexGrow={1}
                scrollbarOptions={{ visible: true }}
              >
                <text fg={theme.text} wrapMode="word">
                  {output() || <span style={{ fg: theme.textMuted }}>Waiting for output...</span>}
                </text>
              </scrollbox>
            </box>

            {/* Input area */}
            <box
              paddingLeft={1}
              paddingRight={1}
              paddingBottom={1}
            >
              <box
                backgroundColor={theme.backgroundPanel}
                padding={1}
                flexDirection="row"
                gap={1}
              >
                <text fg={theme.primary}>❯</text>
                <input
                  flexGrow={1}
                  value={inputValue()}
                  onInput={setInputValue}
                  onReturn={() => sendMessage()}
                  placeholder="Send message to session..."
                  focusedBackgroundColor={theme.backgroundPanel}
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(r) => {
                    inputRef = r
                    setTimeout(() => inputRef?.focus(), 10)
                  }}
                />
              </box>
            </box>

            {/* Footer */}
            <SessionFooter session={s()} />
          </>
        )}
      </Show>
    </box>
  )
}
