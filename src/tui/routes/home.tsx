/**
 * Home screen with dual-column layout
 * Shows session list on left, preview pane on right
 */

import { createMemo, createSignal, For, Show, createEffect, onCleanup } from "solid-js"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogNew } from "@tui/component/dialog-new"
import { DialogFork } from "@tui/component/dialog-fork"
import { DialogRename } from "@tui/component/dialog-rename"
import { attachSessionSync, capturePane } from "@/core/tmux"
import type { Session, SessionStatus } from "@/core/types"
import { formatRelativeTime, formatSmartTime, truncatePath } from "@tui/util/locale"
import { STATUS_ICONS } from "@tui/util/status"

const LOGO = `
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
██╗   ██╗██╗███████╗██╗    ██╗
██║   ██║██║██╔════╝██║    ██║
██║   ██║██║█████╗  ██║ █╗ ██║
╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
 ╚████╔╝ ██║███████╗╚███╔███╔╝
  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝
`.trim()

const SMALL_LOGO = `◆ AGENT VIEW`

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
}

// Minimum width for dual-column layout
const DUAL_COLUMN_MIN_WIDTH = 100
const LEFT_PANEL_RATIO = 0.35

export function Home() {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [previewContent, setPreviewContent] = createSignal<string>("")
  const [previewLoading, setPreviewLoading] = createSignal(false)
  let scrollRef: ScrollBoxRenderable | undefined
  let previewDebounceTimer: ReturnType<typeof setTimeout> | undefined
  let previewFetchAbort = false

  // Check if we should use dual-column layout
  const useDualColumn = createMemo(() => dimensions().width >= DUAL_COLUMN_MIN_WIDTH)

  // Calculate panel widths
  const leftWidth = createMemo(() => {
    if (!useDualColumn()) return dimensions().width
    return Math.floor(dimensions().width * LEFT_PANEL_RATIO)
  })

  const rightWidth = createMemo(() => {
    if (!useDualColumn()) return 0
    return dimensions().width - leftWidth() - 1 // -1 for separator
  })

  // Get sorted sessions (running first, then waiting, then others)
  const sessions = createMemo(() => {
    const all = sync.session.list()
    const statusOrder: SessionStatus[] = ["running", "waiting", "idle", "stopped", "error"]
    return [...all].sort((a, b) => {
      const aOrder = statusOrder.indexOf(a.status)
      const bOrder = statusOrder.indexOf(b.status)
      if (aOrder !== bOrder) return aOrder - bOrder
      return b.lastAccessed.getTime() - a.lastAccessed.getTime()
    })
  })

  // Keep selection in bounds
  createEffect(() => {
    const len = sessions().length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  const selectedSession = createMemo(() => sessions()[selectedIndex()])

  // Fetch preview with debounce; keep showing previous content while loading
  createEffect(() => {
    const session = selectedSession()

    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer)
    }

    if (!session || !session.tmuxSession) {
      setPreviewContent("")
      setPreviewLoading(false)
      return
    }

    // Only show loading if we have no content yet (first load)
    if (!previewContent()) {
      setPreviewLoading(true)
    }
    previewFetchAbort = false

    // Debounce: 150ms delay to prevent rapid fetching during navigation
    previewDebounceTimer = setTimeout(async () => {
      if (previewFetchAbort) return

      try {
        const content = await capturePane(session.tmuxSession, {
          startLine: -200, // Last 200 lines
          join: true
        })

        if (!previewFetchAbort) {
          setPreviewContent(content)
        }
      } catch {
        // Keep existing content on error, don't clear
      } finally {
        if (!previewFetchAbort) {
          setPreviewLoading(false)
        }
      }
    }, 150)
  })

  onCleanup(() => {
    previewFetchAbort = true
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer)
    }
  })

  // Session stats
  const stats = createMemo(() => {
    const byStatus = sync.session.byStatus()
    return {
      running: byStatus.running.length,
      waiting: byStatus.waiting.length,
      total: sync.session.list().length
    }
  })

  function move(delta: number) {
    const len = sessions().length
    if (len === 0) return
    let next = selectedIndex() + delta
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    setSelectedIndex(next)
  }

  function handleAttach(session: Session) {
    if (!session.tmuxSession) {
      toast.show({ message: "Session has no tmux session", variant: "error", duration: 2000 })
      return
    }

    previewFetchAbort = true
    renderer.suspend()
    try {
      attachSessionSync(session.tmuxSession)
    } catch (err) {
      console.error("Attach error:", err)
    }
    renderer.resume()
    sync.refresh()
  }

  async function handleDelete(session: Session) {
    try {
      await sync.session.delete(session.id)
      toast.show({ message: `Deleted ${session.title}`, variant: "info", duration: 2000 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleRestart(session: Session) {
    try {
      await sync.session.restart(session.id)
      toast.show({ message: "Session restarted", variant: "success", duration: 2000 })
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleFork(session: Session) {
    // Only Claude sessions can be forked
    if (session.tool !== "claude") {
      toast.show({ message: "Only Claude sessions can be forked", variant: "error", duration: 2000 })
      return
    }

    try {
      const forked = await sync.session.fork({ sourceSessionId: session.id })
      toast.show({ message: `Forked as ${forked.title}`, variant: "success", duration: 2000 })
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  // Keyboard navigation
  useKeyboard((evt) => {
    // Skip if dialog is open
    if (dialog.stack.length > 0) return

    if (evt.name === "up" || evt.name === "k") {
      move(-1)
    }
    if (evt.name === "down" || evt.name === "j") {
      move(1)
    }
    if (evt.name === "pageup") {
      move(-10)
    }
    if (evt.name === "pagedown") {
      move(10)
    }
    if (evt.name === "home" || evt.name === "g") {
      setSelectedIndex(0)
    }
    if (evt.name === "end") {
      setSelectedIndex(Math.max(0, sessions().length - 1))
    }

    // Enter to attach
    if (evt.name === "return") {
      const session = selectedSession()
      if (session) {
        handleAttach(session)
      }
    }

    // d to delete
    if (evt.name === "d") {
      const session = selectedSession()
      if (session) {
        handleDelete(session)
      }
    }

    // r to restart (lowercase only)
    if (evt.name === "r" && !evt.shift) {
      const session = selectedSession()
      if (session) {
        handleRestart(session)
      }
    }

    // R (Shift+r) to rename
    if (evt.name === "r" && evt.shift) {
      const session = selectedSession()
      if (session) {
        dialog.push(() => <DialogRename session={session} />)
      }
    }

    // f to fork (quick)
    if (evt.name === "f" && !evt.shift) {
      const session = selectedSession()
      if (session) {
        handleFork(session)
      }
    }

    // F (Shift+f) to fork with options dialog
    if (evt.name === "f" && evt.shift) {
      const session = selectedSession()
      if (session) {
        if (session.tool !== "claude") {
          toast.show({ message: "Only Claude sessions can be forked", variant: "error", duration: 2000 })
          return
        }
        dialog.push(() => <DialogFork session={session} />)
      }
    }
  })

  // Get preview lines that fit in the available height
  const previewLines = createMemo(() => {
    const content = previewContent()
    if (!content) return []

    const lines = content.split("\n")
    // Strip trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
      lines.pop()
    }
    return lines
  })

  // Render session list item
  function SessionItem(props: { session: Session; index: number }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const statusColor = createMemo(() => {
      switch (props.session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        default: return theme.textMuted
      }
    })

    const maxTitleLen = useDualColumn() ? 15 : 20
    const title = props.session.title.length > maxTitleLen
      ? props.session.title.slice(0, maxTitleLen - 2) + ".."
      : props.session.title

    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : undefined}
        onMouseUp={() => {
          setSelectedIndex(props.index)
          handleAttach(props.session)
        }}
        onMouseOver={() => setSelectedIndex(props.index)}
      >
        {/* Status icon */}
        <text fg={isSelected() ? theme.selectedListItemText : statusColor()}>
          {STATUS_ICONS[props.session.status]}
        </text>
        <text> </text>

        {/* Title */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={isSelected() ? TextAttributes.BOLD : undefined}
        >
          {title}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Tool (only in single column) */}
        <Show when={!useDualColumn()}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
            {props.session.tool}
          </text>
          <text> </text>
        </Show>

        {/* Time */}
        <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
          {formatSmartTime(props.session.lastAccessed)}
        </text>
      </box>
    )
  }

  // Render preview pane header
  function PreviewHeader() {
    const session = selectedSession()
    if (!session) return null

    const statusColor = createMemo(() => {
      switch (session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        default: return theme.textMuted
      }
    })

    return (
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {/* Session title and status */}
        <box flexDirection="row" justifyContent="space-between" height={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {session.title}
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={statusColor()}>{STATUS_ICONS[session.status]}</text>
            <text fg={statusColor()}>{session.status}</text>
          </box>
        </box>

        {/* Session info */}
        <box flexDirection="row" gap={2} height={1}>
          <text fg={theme.textMuted}>{truncatePath(session.projectPath, rightWidth() - 20)}</text>
        </box>

        {/* More info */}
        <box flexDirection="row" gap={2} height={1}>
          <text fg={theme.accent}>{session.tool}</text>
          <text fg={theme.textMuted}>{formatRelativeTime(session.lastAccessed)}</text>
          <Show when={session.worktreeBranch}>
            <text fg={theme.info}>{session.worktreeBranch}</text>
          </Show>
        </box>

        {/* Separator */}
        <box height={1}>
          <text fg={theme.border}>{"─".repeat(rightWidth() - 2)}</text>
        </box>
      </box>
    )
  }

  // Render empty state with logo
  function EmptyState() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={2}>
        <text fg={theme.primary}>{LOGO}</text>
        <box height={1} />
        <text fg={theme.textMuted}>No sessions yet</text>
        <box flexDirection="row">
          <text fg={theme.textMuted}>Press </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>n</text>
          <text fg={theme.textMuted}> to create a new session</text>
        </box>
      </box>
    )
  }

  // Render logo in preview when no session
  function PreviewLogo() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
        <text fg={theme.primary}>{LOGO}</text>
        <box height={2} />
        <text fg={theme.textMuted}>Select a session to see preview</text>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      {/* Header */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          AGENT VIEW
        </text>
        <box flexDirection="row" gap={2}>
          <Show when={stats().running > 0}>
            <text fg={theme.success}>● {stats().running}</text>
          </Show>
          <Show when={stats().waiting > 0}>
            <text fg={theme.warning}>◐ {stats().waiting}</text>
          </Show>
          <text fg={theme.textMuted}>{stats().total} sessions</text>
        </box>
      </box>

      {/* Main content area */}
      <Show
        when={sessions().length > 0}
        fallback={<EmptyState />}
      >
        <box flexDirection="row" flexGrow={1}>
          {/* Left panel: Session list */}
          <box flexDirection="column" width={leftWidth()}>
            {/* Panel title */}
            <box
              height={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.backgroundElement}
            >
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                SESSIONS
              </text>
            </box>

            {/* Session list */}
            <scrollbox
              flexGrow={1}
              scrollbarOptions={{ visible: true }}
              ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
            >
              <For each={sessions()}>
                {(session, index) => (
                  <SessionItem session={session} index={index()} />
                )}
              </For>
            </scrollbox>
          </box>

          {/* Separator */}
          <Show when={useDualColumn()}>
            <box width={1} backgroundColor={theme.border}>
              <text fg={theme.border}>│</text>
            </box>
          </Show>

          {/* Right panel: Preview */}
          <Show when={useDualColumn()}>
            <box flexDirection="column" width={rightWidth()}>
              {/* Panel title */}
              <box
                height={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  PREVIEW
                </text>
              </box>

              {/* Preview content */}
              <Show
                when={selectedSession()}
                fallback={<PreviewLogo />}
              >
                <box flexDirection="column" flexGrow={1}>
                  <PreviewHeader />

                  {/* Terminal output */}
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
                    <Show
                      when={previewLines().length > 0}
                      fallback={
                        <box paddingLeft={1} paddingTop={1}>
                          <text fg={theme.textMuted}>
                            {previewLoading() ? "Loading..." : "No output yet"}
                          </text>
                        </box>
                      }
                    >
                      <box flexDirection="column" paddingLeft={1}>
                        <For each={previewLines().slice(-50)}>
                          {(line) => (
                            <text fg={theme.text}>{stripAnsi(line).slice(0, rightWidth() - 4)}</text>
                          )}
                        </For>
                      </box>
                    </Show>
                  </scrollbox>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </Show>

      {/* Footer with keybinds */}
      <box
        flexDirection="row"
        width={dimensions().width}
        paddingLeft={2}
        paddingRight={2}
        height={2}
        backgroundColor={theme.backgroundPanel}
        justifyContent="space-between"
      >
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>↑↓</text>
          <text fg={theme.textMuted}>navigate</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>Enter</text>
          <text fg={theme.textMuted}>attach</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>n</text>
          <text fg={theme.textMuted}>new</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>l</text>
          <text fg={theme.textMuted}>list</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>d</text>
          <text fg={theme.textMuted}>delete</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>r</text>
          <text fg={theme.textMuted}>restart</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>R</text>
          <text fg={theme.textMuted}>rename</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>f</text>
          <text fg={theme.textMuted}>fork</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>F</text>
          <text fg={theme.textMuted}>fork+wt</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>Ctrl+Q</text>
          <text fg={theme.textMuted}>detach</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>q</text>
          <text fg={theme.textMuted}>quit</text>
        </box>
      </box>
    </box>
  )
}
