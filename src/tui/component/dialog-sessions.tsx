/**
 * Session list dialog
 * Main navigation component
 */

import { createMemo, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { attachSessionSync } from "@/core/tmux"
import type { Session, SessionStatus } from "@/core/types"
import { formatSmartTime, truncatePath } from "@tui/util/locale"
import { STATUS_ICONS } from "@tui/util/status"

const STATUS_ORDER: SessionStatus[] = ["running", "waiting", "idle", "stopped", "error"]

export function DialogSessions() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()

  const currentSessionId = createMemo(() => {
    return route.data.type === "session" ? route.data.sessionId : undefined
  })

  // Build options grouped by status
  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const sessions = sync.session.list()
    const byStatus = sync.session.byStatus()

    const result: DialogSelectOption<string>[] = []

    for (const status of STATUS_ORDER) {
      const sessionsInStatus = byStatus[status] || []
      if (sessionsInStatus.length === 0) continue

      for (const session of sessionsInStatus) {
        result.push({
          title: session.title,
          value: session.id,
          category: `${STATUS_ICONS[status]} ${status.charAt(0).toUpperCase() + status.slice(1)} (${sessionsInStatus.length})`,
          description: truncatePath(session.projectPath),
          footer: formatSmartTime(session.lastAccessed),
          gutter: <StatusGutter status={session.status} acknowledged={session.acknowledged} />
        })
      }
    }

    return result
  })

  async function handleDelete(sessionId: string) {
    const session = sync.session.get(sessionId)
    if (!session) return

    async function doDelete(deleteWorktree: boolean) {
      try {
        await sync.session.delete(sessionId, { deleteWorktree })
        const msg = deleteWorktree
          ? `Deleted ${session!.title} and worktree`
          : `Deleted ${session!.title}`
        toast.show({ message: msg, variant: "info", duration: 2000 })

        // If we deleted the current session, go home
        if (currentSessionId() === sessionId) {
          route.navigate({ type: "home" })
        }
      } catch (err) {
        toast.error(err as Error)
      }
    }

    if (session.worktreePath) {
      dialog.push(() => (
        <DialogSelect
          title={`Delete "${session.title}"?`}
          options={[
            { title: "Delete session and worktree", value: "delete-worktree" },
            { title: "Delete session only", value: "delete-session" },
          ]}
          onSelect={async (opt) => {
            dialog.pop()
            await doDelete(opt.value === "delete-worktree")
          }}
        />
      ))
      return
    }

    await doDelete(false)
  }

  async function handleRestart(sessionId: string) {
    try {
      await sync.session.restart(sessionId)
      toast.show({ message: "Session restarted", variant: "success", duration: 2000 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleFork(sessionId: string) {
    try {
      const forked = await sync.session.fork({ sourceSessionId: sessionId })
      toast.show({ message: `Forked as ${forked.title}`, variant: "success", duration: 2000 })
      route.navigate({ type: "session", sessionId: forked.id })
      dialog.clear()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function handleAttach(sessionId: string) {
    const session = sync.session.get(sessionId)
    if (!session) {
      toast.show({ message: "Session not found", variant: "error", duration: 2000 })
      return
    }

    if (!session.tmuxSession) {
      toast.show({ message: "Session has no tmux session", variant: "error", duration: 2000 })
      return
    }

    // Suspend the TUI
    renderer.suspend()

    // Use sync attach - this blocks the event loop completely
    // User detaches with standard tmux: Ctrl+B, D
    try {
      attachSessionSync(session.tmuxSession)
    } catch (err) {
      console.error("Attach error:", err)
    }

    // Resume the TUI when we return
    renderer.resume()

    // Clear dialog and refresh after resume
    dialog.clear()
    sync.refresh()
  }

  return (
    <DialogSelect
      title="Sessions"
      placeholder="Filter sessions..."
      options={options()}
      current={currentSessionId()}
      flat
      onSelect={(option) => {
        handleAttach(option.value)
      }}
      keybinds={[
        { key: "d", title: "Delete", onTrigger: (opt) => handleDelete(opt.value) },
        { key: "r", title: "Restart", onTrigger: (opt) => handleRestart(opt.value) },
        { key: "f", title: "Fork", onTrigger: (opt) => handleFork(opt.value) },
        { key: "v", title: "View", onTrigger: (opt) => {
          route.navigate({ type: "session", sessionId: opt.value })
          dialog.clear()
        }}
      ]}
    />
  )
}

function StatusGutter(props: { status: SessionStatus; acknowledged: boolean }) {
  const { theme } = useTheme()

  const color = createMemo(() => {
    switch (props.status) {
      case "running":
        return theme.success
      case "waiting":
        return theme.warning
      case "error":
        return theme.error
      case "idle":
        return theme.textMuted
      case "stopped":
        return theme.textMuted
    }
  })

  return (
    <text fg={color()} flexShrink={0}>
      {STATUS_ICONS[props.status]}
      <Show when={!props.acknowledged && (props.status === "waiting" || props.status === "error")}>
        <span style={{ fg: theme.warning }}>!</span>
      </Show>
    </text>
  )
}
