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
import { attachSessionSync, wasSessionListRequested } from "@/core/tmux"
import type { Session, SessionStatus, RemoteSession } from "@/core/types"
import { isRemoteSession } from "@/core/types"
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

  // Use large dialog for better display of session info
  dialog.setSize("large")

  const currentSessionId = createMemo(() => {
    return route.data.type === "session" ? route.data.sessionId : undefined
  })

  // Build options grouped by status (local + remote)
  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const byStatus = sync.session.byStatus()
    const remoteSessions = sync.remote.list()

    const result: DialogSelectOption<string>[] = []

    // Local sessions grouped by status
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

    // Remote sessions
    if (remoteSessions.length > 0) {
      for (const session of remoteSessions) {
        result.push({
          title: `${session.title} @${session.remoteName}`,
          value: `remote:${session.remoteName}:${session.id}`,
          category: `🌐 Remote (${remoteSessions.length})`,
          description: truncatePath(session.projectPath),
          footer: session.status,
          gutter: <StatusGutter status={session.status} acknowledged={true} />
        })
      }
    }

    return result
  })

  async function handleDelete(sessionId: string) {
    // Handle remote session delete
    if (sessionId.startsWith("remote:")) {
      const parts = sessionId.split(":")
      const remoteName = parts[1]
      const remoteSessionId = parts.slice(2).join(":")
      const remoteSession = sync.remote.list().find(s => s.remoteName === remoteName && s.id === remoteSessionId)
      if (!remoteSession) return

      try {
        await sync.remote.delete(remoteSession)
        toast.show({ message: `Deleted remote session`, variant: "info", duration: 2000 })
      } catch (err) {
        toast.error(err as Error)
      }
      return
    }

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
    // Handle remote session restart
    if (sessionId.startsWith("remote:")) {
      const parts = sessionId.split(":")
      const remoteName = parts[1]
      const remoteSessionId = parts.slice(2).join(":")
      const remoteSession = sync.remote.list().find(s => s.remoteName === remoteName && s.id === remoteSessionId)
      if (!remoteSession) return

      try {
        await sync.remote.restart(remoteSession)
        toast.show({ message: "Remote session restarted", variant: "success", duration: 2000 })
      } catch (err) {
        toast.error(err as Error)
      }
      return
    }

    try {
      await sync.session.restart(sessionId)
      toast.show({ message: "Session restarted", variant: "success", duration: 2000 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleFork(sessionId: string) {
    // Fork not supported for remote sessions
    if (sessionId.startsWith("remote:")) {
      toast.show({ message: "Fork not supported for remote sessions", variant: "error", duration: 2000 })
      return
    }

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
    // Check if this is a remote session
    if (sessionId.startsWith("remote:")) {
      const parts = sessionId.split(":")
      const remoteName = parts[1]
      const remoteSessionId = parts.slice(2).join(":")

      const remoteSession = sync.remote.list().find(s => s.remoteName === remoteName && s.id === remoteSessionId)
      if (!remoteSession) {
        toast.show({ message: "Remote session not found", variant: "error", duration: 2000 })
        return
      }

      // Suspend the TUI and attach to remote
      renderer.suspend()
      let sessionListRequested = false
      try {
        sessionListRequested = sync.remote.attach(remoteSession)
      } catch (err) {
        console.error("Remote attach error:", err)
      }
      renderer.resume()
      sync.refresh()
      sync.refreshRemote()

      // Check if Ctrl+L was pressed on remote
      if (sessionListRequested) {
        dialog.replace(() => <DialogSessions />)
      } else {
        dialog.clear()
      }
      return
    }

    // Local session
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

    // Check if user pressed Ctrl+L to reopen session list
    if (wasSessionListRequested()) {
      dialog.replace(() => <DialogSessions />)
    }
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
          if (opt.value.startsWith("remote:")) {
            toast.show({ message: "View not supported for remote sessions", variant: "error", duration: 2000 })
            return
          }
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
