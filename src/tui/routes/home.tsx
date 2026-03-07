/**
 * Home screen with dual-column layout
 * Shows session list on left, preview pane on right
 */

import { createMemo, createSignal, For, Show, createEffect, onCleanup, type Accessor } from "solid-js"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { DialogNew } from "@tui/component/dialog-new"
import { DialogSessions } from "@tui/component/dialog-sessions"
import { DialogFork } from "@tui/component/dialog-fork"
import { DialogRename } from "@tui/component/dialog-rename"
import { DialogGroup } from "@tui/component/dialog-group"
import { DialogMove } from "@tui/component/dialog-move"
import { DialogShortcuts } from "@tui/component/dialog-shortcuts"
import { DialogRecents } from "@tui/component/dialog-recents"
import { DialogSettings } from "@tui/component/dialog-settings"
import { DialogNewRemote } from "@tui/component/dialog-new-remote"
import { DialogHelp } from "@tui/component/dialog-help"
import { getShortcuts } from "@/core/config"
import { executeShortcut, getShortcutGroupPath } from "@/core/shortcut"
import { useKeybind } from "@tui/context/keybind"
import { useKV } from "@tui/context/kv"
import { DialogUpdate } from "@tui/component/dialog-update"
import { attachSessionSync, capturePane, wasCommandPaletteRequested, wasSessionListRequested, sendKeys } from "@/core/tmux"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { Session, Group, RemoteSession } from "@/core/types"
import { isRemoteSession } from "@/core/types"
import { formatRelativeTime, truncatePath } from "@tui/util/locale"
import { STATUS_ICONS } from "@tui/util/status"
import { sortSessionsByCreatedAt } from "@tui/util/session"
import { createListNavigation } from "@tui/util/navigation"
import {
  flattenGroupTree,
  ensureDefaultGroup,
  getGroupSessionCount,
  getGroupStatusSummary,
  DEFAULT_GROUP_PATH,
  type GroupedItem
} from "@tui/util/groups"
import fs from "fs"
import path from "path"
import os from "os"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [HOME] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

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
const LEFT_PANEL_MIN_WIDTH = 30
const LEFT_PANEL_MAX_RATIO = 0.5 // Never take more than 50% of screen
const RIGHT_PANEL_MIN_WIDTH = 40 // Always leave room for preview

export function Home() {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const kv = useKV()

  const shortcuts = createMemo(() => getShortcuts())
  const updateInfo = () => kv.get<{ current: string; latest: string } | null>("updateInfo", null)

  // Drain auto-hibernated notifications periodically
  const autoHibernateInterval = setInterval(() => {
    const items = sync.session.drainAutoHibernated()
    for (const item of items) {
      toast.show({
        message: `Auto-hibernated ${item.title} (idle ${item.idleMinutes >= 60 ? `${Math.round(item.idleMinutes / 60)}h` : `${item.idleMinutes}m`})`,
        variant: "info",
        duration: 4000
      })
    }
  }, 1000)
  onCleanup(() => clearInterval(autoHibernateInterval))

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [previewContent, setPreviewContent] = createSignal<string>("")
  const [previewLoading, setPreviewLoading] = createSignal(false)
  let scrollRef: ScrollBoxRenderable | undefined
  let previewScrollRef: ScrollBoxRenderable | undefined
  let previewDebounceTimer: ReturnType<typeof setTimeout> | undefined
  let previewFetchAbort = false

  const useDualColumn = createMemo(() => dimensions().width >= DUAL_COLUMN_MIN_WIDTH)

  // Calculate longest session/group title for dynamic panel sizing
  const longestTitleLen = createMemo(() => {
    const sessions = sync.session.list()
    const remoteSessions = sync.remote.list()
    const groups = sync.group.list()
    let maxLen = 0
    for (const s of sessions) {
      if (s.title.length > maxLen) maxLen = s.title.length
    }
    for (const s of remoteSessions) {
      // Remote sessions show "title @host" so include host length
      const displayLen = s.title.length + s.remoteName.length + 2
      if (displayLen > maxLen) maxLen = displayLen
    }
    for (const g of groups) {
      if (g.name.length > maxLen) maxLen = g.name.length
    }
    return maxLen
  })

  const leftWidth = createMemo(() => {
    if (!useDualColumn()) return dimensions().width

    // Fixed elements: padding(2) + indent(2) + status(2) + memory(6) = 12
    const fixedWidth = 12
    const neededWidth = longestTitleLen() + fixedWidth

    const maxAllowed = Math.floor(dimensions().width * LEFT_PANEL_MAX_RATIO)
    const minForPreview = dimensions().width - RIGHT_PANEL_MIN_WIDTH - 1

    // Clamp: at least LEFT_PANEL_MIN_WIDTH, at most maxAllowed or what leaves room for preview
    return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(neededWidth, maxAllowed, minForPreview))
  })

  const rightWidth = createMemo(() => {
    if (!useDualColumn()) return 0
    return dimensions().width - leftWidth() - 1 // -1 for separator
  })

  // Ensure default group exists on first load
  createEffect(() => {
    const currentGroups = sync.group.list()
    const withDefault = ensureDefaultGroup(currentGroups)
    if (withDefault.length !== currentGroups.length) {
      sync.group.save(withDefault)
    }
  })

  const localSessions = createMemo(() => sync.session.list())
  const remoteSessions = createMemo(() => sync.remote.list())
  const allSessions = createMemo(() => [...localSessions(), ...remoteSessions()])

  const groupedItems = createMemo(() => {
    const groups = ensureDefaultGroup(sync.group.list())
    return flattenGroupTree(allSessions(), groups)
  })

  createEffect(() => {
    const len = groupedItems().length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  const selectedItem = createMemo(() => groupedItems()[selectedIndex()])

  const selectedSession = createMemo(() => {
    const item = selectedItem()
    return item?.type === "session" ? item.session : undefined
  })

  const selectedGroup = createMemo(() => {
    const item = selectedItem()
    return item?.type === "group" ? item.group : undefined
  })

  const move = createListNavigation(
    () => groupedItems().length,
    selectedIndex,
    setSelectedIndex
  )

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
    // Reset scroll position for new session
    setTimeout(() => {
      if (previewScrollRef) {
        previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
      }
    }, 0)

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
          // Scroll to bottom after render
          setTimeout(() => {
            if (previewScrollRef) {
              previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
            }
          }, 0)
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

  const stats = createMemo(() => {
    const byStatus = sync.session.byStatus()
    const remotes = remoteSessions()
    return {
      running: byStatus.running.length + remotes.filter(s => s.status === "running").length,
      waiting: byStatus.waiting.length + remotes.filter(s => s.status === "waiting").length,
      total: sync.session.list().length,
      remoteTotal: remotes.length
    }
  })

  function jumpToGroup(groupIndex: number) {
    const items = groupedItems()
    const idx = items.findIndex(item => item.type === "group" && item.groupIndex === groupIndex)
    if (idx >= 0) {
      setSelectedIndex(idx)
    }
  }

  async function handleDeleteGroup(group: Group) {
    const sessionCount = getGroupSessionCount(allSessions(), group.path)

    // Don't allow deleting default group
    if (group.path === DEFAULT_GROUP_PATH) {
      toast.show({ message: "Cannot delete the default group", variant: "error", duration: 2000 })
      return
    }

    // Move sessions to default group before deleting
    if (sessionCount > 0) {
      const sessionsInGroup = allSessions().filter(s => s.groupPath === group.path)
      for (const session of sessionsInGroup) {
        sync.session.moveToGroup(session.id, DEFAULT_GROUP_PATH)
      }
    }

    sync.group.delete(group.path)
    toast.show({ message: `Deleted group "${group.name}"`, variant: "info", duration: 2000 })
    sync.refresh()
  }

  function doAttach(session: Session) {
    previewFetchAbort = true
    renderer.suspend()
    let remoteSessionListRequested = false
    try {
      if (isRemoteSession(session)) {
        // Attach to remote session via SSH - returns true if Ctrl+L was pressed
        remoteSessionListRequested = sync.remote.attach(session)
      } else {
        attachSessionSync(session.tmuxSession)
      }
    } catch (err) {
      console.error("Attach error:", err)
    }
    renderer.resume()
    sync.refresh()

    if (isRemoteSession(session)) {
      sync.refreshRemote()
      // Check if Ctrl+L was pressed on remote
      if (remoteSessionListRequested) {
        dialog.replace(() => <DialogSessions />)
      }
    } else {
      // Check if user pressed Ctrl+K to open command palette (local only)
      if (wasCommandPaletteRequested()) {
        command.open()
      }
      // Check if user pressed Ctrl+L to open session list (local only)
      if (wasSessionListRequested()) {
        dialog.replace(() => <DialogSessions />)
      }
    }
  }

  function handleAttach(session: Session) {
    // For remote sessions, check remoteName instead of tmuxSession
    if (isRemoteSession(session)) {
      // If remote session is stopped or hibernated, offer to resume or restart
      if (session.status === "stopped" || session.status === "hibernated") {
        const isClaudeWithSession = session.tool === "claude" && session.toolData?.claudeSessionId
        const options = [
          ...(isClaudeWithSession
            ? [{ title: "Resume session", value: "resume" }]
            : []),
          { title: "Restart session", value: "restart" },
        ]

        dialog.replace(() => (
          <DialogSelect
            title={`"${session.title}" is ${session.status} (@${session.remoteName})`}
            options={options}
            onSelect={async (opt) => {
              dialog.clear()
              try {
                if (opt.value === "resume") {
                  await sync.remote.resume(session)
                } else {
                  await sync.remote.restart(session)
                }
                toast.show({ message: `Session ${opt.value === "resume" ? "resumed" : "restarted"}`, variant: "success", duration: 2000 })
                await sync.refreshRemote()
                doAttach(session)
              } catch (err) {
                toast.error(err as Error)
              }
            }}
          />
        ))
        return
      }

      doAttach(session)
      return
    }

    // Local session handling
    if (!session.tmuxSession) {
      toast.show({ message: "Session has no tmux session", variant: "error", duration: 2000 })
      return
    }

    // If session is stopped or hibernated, offer to resume or restart
    if (session.status === "stopped" || session.status === "hibernated") {
      const isClaudeWithSession = session.tool === "claude" && session.toolData?.claudeSessionId
      const options = [
        ...(isClaudeWithSession
          ? [{ title: "Resume session", value: "resume" }]
          : []),
        { title: "Restart session", value: "restart" },
      ]

      dialog.replace(() => (
        <DialogSelect
          title={`"${session.title}" is ${session.status}`}
          options={options}
          onSelect={async (opt) => {
            dialog.clear()
            try {
              let updated: Session
              if (opt.value === "resume") {
                updated = await sync.session.resume(session.id)
              } else {
                updated = await sync.session.restart(session.id)
              }
              toast.show({ message: `Session ${opt.value === "resume" ? "resumed" : "restarted"}`, variant: "success", duration: 2000 })
              sync.refresh()
              doAttach(updated)
            } catch (err) {
              toast.error(err as Error)
            }
          }}
        />
      ))
      return
    }

    doAttach(session)
  }

  async function handleDelete(session: Session) {
    // Handle remote session deletion
    if (isRemoteSession(session)) {
      dialog.replace(() => (
        <DialogSelect
          title={`Delete "${session.title}" on @${session.remoteName}?`}
          options={[
            { title: "Delete", value: "delete" },
            { title: "Cancel", value: "cancel" },
          ]}
          onSelect={async (opt) => {
            dialog.clear()
            if (opt.value === "cancel") return
            try {
              await sync.remote.delete(session)
              toast.show({ message: `Deleted ${session.title} on @${session.remoteName}`, variant: "info", duration: 2000 })
            } catch (err) {
              toast.error(err as Error)
            }
          }}
        />
      ))
      return
    }

    // Local session deletion
    if (session.worktreePath) {
      dialog.replace(() => (
        <DialogSelect
          title={`Delete "${session.title}"?`}
          options={[
            { title: "Delete session and worktree", value: "delete-worktree" },
            { title: "Delete session only", value: "delete-session" },
          ]}
          onSelect={async (opt) => {
            dialog.clear()
            try {
              await sync.session.delete(session.id, { deleteWorktree: opt.value === "delete-worktree" })
              const msg = opt.value === "delete-worktree"
                ? `Deleted ${session.title} and worktree`
                : `Deleted ${session.title}`
              toast.show({ message: msg, variant: "info", duration: 2000 })
            } catch (err) {
              toast.error(err as Error)
            }
          }}
        />
      ))
      return
    }

    // Local session without worktree - show confirmation dialog
    dialog.replace(() => (
      <DialogSelect
        title={`Delete "${session.title}"?`}
        options={[
          { title: "Delete", value: "delete" },
          { title: "Cancel", value: "cancel" },
        ]}
        onSelect={async (opt) => {
          dialog.clear()
          if (opt.value === "cancel") return
          try {
            await sync.session.delete(session.id)
            toast.show({ message: `Deleted ${session.title}`, variant: "info", duration: 2000 })
          } catch (err) {
            toast.error(err as Error)
          }
        }}
      />
    ))
  }

  async function handleRestart(session: Session) {
    try {
      if (isRemoteSession(session)) {
        await sync.remote.restart(session)
        toast.show({ message: `Session restarted on @${session.remoteName}`, variant: "success", duration: 2000 })
        await sync.refreshRemote()
      } else {
        await sync.session.restart(session.id)
        toast.show({ message: "Session restarted", variant: "success", duration: 2000 })
        sync.refresh()
      }
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleShortcut(shortcut: ReturnType<typeof getShortcuts>[0]) {
    try {
      const session = await executeShortcut({ shortcut })
      const groupPath = getShortcutGroupPath(shortcut)
      toast.show({
        message: `Created '${shortcut.name}' in ${groupPath} group`,
        variant: "success",
        duration: 2000
      })

      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleFork(session: Session) {
    log("handleFork called for session:", session.id, "tool:", session.tool, "projectPath:", session.projectPath)

    if (isRemoteSession(session)) {
      log("Fork rejected: remote session")
      toast.show({ message: "Remote sessions cannot be forked from here", variant: "error", duration: 2000 })
      return
    }

    if (session.tool !== "claude") {
      log("Fork rejected: not a claude session")
      toast.show({ message: "Only Claude sessions can be forked", variant: "error", duration: 2000 })
      return
    }

    log("Checking canFork for session:", session.id)
    const canForkSession = await sync.session.canFork(session.id)
    log("canFork result:", canForkSession)

    if (!canForkSession) {
      log("Fork rejected: no conversation found")
      toast.show({
        message: "Cannot fork: no conversation found. Have at least one exchange with Claude first.",
        variant: "error",
        duration: 3000
      })
      return
    }

    try {
      log("Calling sync.session.fork")
      const forked = await sync.session.fork({ sourceSessionId: session.id })
      log("Fork successful:", forked.id)
      toast.show({ message: `Forked as ${forked.title}`, variant: "success", duration: 2000 })
      sync.refresh()
    } catch (err) {
      log("Fork error:", err)
      toast.error(err as Error)
    }
  }

  async function handleHibernate(session: Session) {
    try {
      if (isRemoteSession(session)) {
        await sync.remote.hibernate(session)
        toast.show({ message: `Hibernated ${session.title} on @${session.remoteName}`, variant: "success", duration: 2000 })
        await sync.refreshRemote()
      } else {
        await sync.session.hibernate(session.id)
        toast.show({ message: `Hibernated ${session.title}`, variant: "success", duration: 2000 })
        sync.refresh()
      }
    } catch (err) {
      toast.error(err as Error)
    }
  }

  useKeyboard((evt) => {
    log("Home useKeyboard:", evt.name, "dialog.stack.length:", dialog.stack.length)

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
    if (evt.name === "home") {
      setSelectedIndex(0)
    }
    if (evt.name === "end") {
      setSelectedIndex(Math.max(0, groupedItems().length - 1))
    }

    // Number keys 1-9 to jump to groups
    if (/^[1-9]$/.test(evt.name)) {
      jumpToGroup(parseInt(evt.name, 10))
    }

    // Right arrow: expand group (or attach to session)
    if (evt.name === "right" || evt.name === "l") {
      const item = selectedItem()
      if (item?.type === "group" && item.group && !item.group.expanded) {
        sync.group.toggle(item.group.path)
      } else if (item?.type === "session" && item.session) {
        handleAttach(item.session)
      }
    }

    // Left arrow: collapse group
    if (evt.name === "left" || evt.name === "h") {
      const item = selectedItem()
      if (item?.type === "group" && item.group && item.group.expanded) {
        sync.group.toggle(item.group.path)
      } else if (item?.type === "session") {
        // When on a session, collapse its parent group
        const groupItem = groupedItems().find(
          i => i.type === "group" && i.groupPath === item.groupPath
        )
        if (groupItem?.group?.expanded) {
          sync.group.toggle(groupItem.group.path)
        }
      }
    }

    // Enter: attach to session OR toggle group expand/collapse
    if (evt.name === "return") {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        handleAttach(item.session)
      } else if (item?.type === "group" && item.group) {
        sync.group.toggle(item.group.path)
      }
    }

    // d to delete session OR group
    if (evt.name === "d") {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        const session = item.session
        dialog.push(() => (
          <DialogSelect
            title={`Delete "${session.title}"?`}
            options={[
              { title: "Delete", value: "delete" },
              { title: "Cancel", value: "cancel" },
            ]}
            onSelect={(opt) => {
              dialog.clear()
              if (opt.value === "delete") {
                handleDelete(session)
              }
            }}
          />
        ))
      } else if (item?.type === "group" && item.group) {
        handleDeleteGroup(item.group)
      }
    }

    // r to restart (lowercase only, sessions only)
    if (evt.name === "r" && !evt.shift) {
      const session = selectedSession()
      if (session) {
        dialog.push(() => (
          <DialogSelect
            title={`Restart "${session.title}"?`}
            options={[
              { title: "Restart", value: "restart" },
              { title: "Cancel", value: "cancel" },
            ]}
            onSelect={(opt) => {
              dialog.clear()
              if (opt.value === "restart") {
                handleRestart(session)
              }
            }}
          />
        ))
      }
    }

    // R (Shift+r) to rename session OR group
    if (evt.name === "r" && evt.shift) {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        if (isRemoteSession(item.session)) {
          toast.show({ message: "Rename not supported for remote sessions", variant: "error", duration: 2000 })
          return
        }
        dialog.push(() => <DialogRename session={item.session!} />)
      } else if (item?.type === "group" && item.group) {
        dialog.push(() => <DialogGroup mode="rename" group={item.group!} />)
      }
    }

    // g to create new group
    if (evt.name === "g" && !evt.shift) {
      dialog.push(() => <DialogGroup mode="create" />)
    }

    // m to move session to group
    if (evt.name === "m") {
      const session = selectedSession()
      if (session) {
        if (isRemoteSession(session)) {
          toast.show({ message: "Move not supported for remote sessions", variant: "error", duration: 2000 })
          return
        }
        dialog.push(() => <DialogMove session={session} />)
      }
    }

    // f to fork (quick)
    if (evt.name === "f" && !evt.shift) {
      log("f pressed, selectedSession:", selectedSession()?.id, selectedSession()?.tool)
      const session = selectedSession()
      if (session) {
        log("Calling handleFork for session:", session.id)
        handleFork(session)
      }
    }

    // F (Shift+f) to fork with options dialog
    if (evt.name === "f" && evt.shift) {
      evt.preventDefault()
      const session = selectedSession()
      if (session) {
        if (isRemoteSession(session)) {
          toast.show({ message: "Remote sessions cannot be forked from here", variant: "error", duration: 2000 })
          return
        }
        if (session.tool !== "claude") {
          toast.show({ message: "Only Claude sessions can be forked", variant: "error", duration: 2000 })
          return
        }
        dialog.push(() => <DialogFork session={session} />)
      }
      return
    }

    // z to hibernate session
    if (evt.name === "z" && !evt.shift && !evt.ctrl) {
      const session = selectedSession()
      if (session) {
        if (session.tool !== "claude" || !session.toolData?.claudeSessionId) {
          toast.show({ message: "Only Claude sessions with a session ID can be hibernated", variant: "error", duration: 2000 })
          return
        }
        if (session.status === "stopped" || session.status === "hibernated") {
          toast.show({ message: "Session is already stopped/hibernated", variant: "error", duration: 2000 })
          return
        }
        handleHibernate(session)
      }
      return
    }

    // y to quick-confirm a waiting session (sends Enter without attaching)
    if (evt.name === "y" && !evt.shift && !evt.ctrl) {
      const session = selectedSession()
      if (session && session.status === "waiting") {
        if (isRemoteSession(session)) {
          toast.show({ message: "Quick confirm not supported for remote sessions", variant: "error", duration: 2000 })
          return
        }
        if (session.tmuxSession) {
          sendKeys(session.tmuxSession, "").then(() => {
            toast.show({ message: "✓ Confirmed", variant: "success", duration: 1500 })
            sync.refresh()
          }).catch((err) => {
            toast.error(err as Error)
          })
        }
      }
      return
    }

    // u to open update dialog
    if (evt.name === "u" && !evt.shift && !evt.ctrl) {
      const info = updateInfo()
      if (info) {
        dialog.push(() => <DialogUpdate current={info.current} latest={info.latest} />)
      }
      return
    }

    // s to open shortcuts dialog
    if (evt.name === "s" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogShortcuts />)
      return
    }

    // o to open recents dialog
    if (evt.name === "o" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogRecents />)
      return
    }

    // c to open settings dialog
    if (evt.name === "c" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogSettings />)
      return
    }

    // ? to open help dialog
    if (evt.name === "?") {
      dialog.push(() => <DialogHelp />)
      return
    }

    // N (Shift+n) to create new remote session
    if (evt.name === "n" && evt.shift) {
      dialog.push(() => <DialogNewRemote />)
      return
    }

    const currentShortcuts = shortcuts()
    for (const shortcut of currentShortcuts) {
      if (shortcut.keybind && keybind.matchDynamic(shortcut.keybind, evt)) {
        handleShortcut(shortcut)
        return
      }
    }
  })

  const previewLines = createMemo(() => {
    const content = previewContent()
    if (!content) return []

    const lines = content.split("\n")
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
      lines.pop()
    }
    return lines
  })

  function GroupHeader(props: { group: Group; index: number }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const statusSummary = createMemo(() => getGroupStatusSummary(allSessions(), props.group.path))

    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : theme.backgroundElement}
        onMouseUp={() => {
          setSelectedIndex(props.index)
          sync.group.toggle(props.group.path)
        }}
        onMouseOver={() => setSelectedIndex(props.index)}
      >
        {/* Expand/collapse arrow */}
        <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
          {props.group.expanded ? "\u25BC" : "\u25B6"}
        </text>
        <text> </text>

        {/* Group name */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={TextAttributes.BOLD}
        >
          {props.group.name}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Status indicators */}
        <Show when={statusSummary().running > 0}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.success}>
            {STATUS_ICONS.running}{statusSummary().running}
          </text>
          <text> </text>
        </Show>
        <Show when={statusSummary().waiting > 0}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.warning}>
            {STATUS_ICONS.waiting}{statusSummary().waiting}
          </text>
        </Show>
      </box>
    )
  }

  function SessionItem(props: { session: Session; index: number; indented?: boolean }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const isRemote = createMemo(() => isRemoteSession(props.session))
    const statusColor = createMemo(() => {
      switch (props.session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        case "hibernated": return theme.secondary
        default: return theme.textMuted
      }
    })

    const indent = props.indented ? 2 : 0

    // Calculate available space for title dynamically
    // Layout: [padding] [indent] [status icon + space] [title] [spacer] [memory?] [padding]
    const reservedWidth = createMemo(() => {
      let reserved = 2 // left + right padding
      reserved += indent // indentation
      reserved += 2 // status icon + space
      reserved += 6 // memory indicator (e.g., "512M ")
      if (!useDualColumn()) {
        reserved += 8 // tool name + space in single column mode
      }
      // Reserve space for remote indicator
      if (isRemote()) {
        const remoteName = (props.session as RemoteSession).remoteName
        reserved += remoteName.length + 2 // "@name "
      }
      return reserved
    })

    const maxTitleLen = createMemo(() => Math.max(10, leftWidth() - reservedWidth()))
    const title = createMemo(() => {
      const max = maxTitleLen()
      return props.session.title.length > max
        ? props.session.title.slice(0, max - 2) + ".."
        : props.session.title
    })

    return (
      <box
        flexDirection="row"
        paddingLeft={1 + indent}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : undefined}
        onMouseUp={() => {
          setSelectedIndex(props.index)
          handleAttach(props.session)
        }}
        onMouseOver={() => setSelectedIndex(props.index)}
      >
        {/* Status icon with fixed width */}
        <box width={2} flexShrink={0}>
          <text fg={isSelected() ? theme.selectedListItemText : statusColor()}>
            {STATUS_ICONS[props.session.status]}
          </text>
        </box>

        {/* Title */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={isSelected() ? TextAttributes.BOLD : undefined}
        >
          {title()}
        </text>

        {/* Remote indicator */}
        <Show when={isRemote()}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.info}>
            {" @" + (props.session as RemoteSession).remoteName}
          </text>
        </Show>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Tool (only in single column) */}
        <Show when={!useDualColumn()}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
            {props.session.tool}
          </text>
          <text> </text>
        </Show>

        {/* Memory or hibernation indicator */}
        <Show when={props.session.status === "hibernated"} fallback={
          <Show when={sync.session.getMemoryMB(props.session.id)}>
            {(mb: () => number) => (
              <box flexShrink={0}>
                <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                  {" " + (mb() >= 1024 ? `${(mb() / 1024).toFixed(1)}G` : `${mb()}M`)}
                </text>
              </box>
            )}
          </Show>
        }>
          <box flexShrink={0}>
            <text>{" \uD83D\uDE34"}</text>
          </box>
        </Show>

      </box>
    )
  }

  function PreviewHeader() {
    const session = () => selectedSession()

    const statusColor = createMemo(() => {
      const s = session()
      if (!s) return theme.textMuted
      switch (s.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        case "hibernated": return theme.secondary
        default: return theme.textMuted
      }
    })

    return (
      <Show when={session()}>
        {(s: Accessor<Session>) => (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            {/* Session title and status */}
            <box flexDirection="row" justifyContent="space-between" height={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {s().title}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={statusColor()}>{STATUS_ICONS[s().status]}</text>
                <text fg={statusColor()}>{s().status}</text>
                <Show when={s().status === "waiting"}>
                  <text fg={theme.warning}>  [y] confirm</text>
                </Show>
              </box>
            </box>

            {/* Session info */}
            <box flexDirection="row" gap={2} height={1}>
              <text fg={theme.textMuted}>{truncatePath(s().projectPath, rightWidth() - 20)}</text>
            </box>

            {/* Time and tool info */}
            <box flexDirection="row" gap={2} height={1}>
              <text fg={theme.accent}>{s().tool}</text>
              <text fg={theme.textMuted}>{formatRelativeTime(s().lastAccessed)}</text>
              <Show when={s().worktreeBranch}>
                <text fg={theme.info}>{s().worktreeBranch}</text>
              </Show>
              <Show when={isRemoteSession(s())}>
                <text fg={theme.info}>@{(s() as RemoteSession).remoteName}</text>
              </Show>
            </box>

            {/* Separator */}
            <box height={1}>
              <text fg={theme.border}>{"─".repeat(rightWidth() - 2)}</text>
            </box>
          </box>
        )}
      </Show>
    )
  }

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
          <Show when={stats().remoteTotal > 0}>
            <text fg={theme.info}>({stats().remoteTotal} remote)</text>
          </Show>
        </box>
      </box>

      {/* Main content area */}
      <Show
        when={allSessions().length > 0}
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

            {/* Session list (grouped) */}
            <scrollbox
              flexGrow={1}
              scrollbarOptions={{ visible: true }}
              ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
            >
              <For each={groupedItems()}>
                {(item, index) => (
                  <Show
                    when={item.type === "group"}
                    fallback={
                      <SessionItem
                        session={item.session!}
                        index={index()}
                        indented={true}
                      />
                    }
                  >
                    <GroupHeader group={item.group!} index={index()} />
                  </Show>
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
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }} ref={(r: ScrollBoxRenderable) => { previewScrollRef = r }}>
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
          <text fg={theme.text}>Enter</text>
          <text fg={theme.textMuted}>attach</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>n</text>
          <text fg={theme.textMuted}>new</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>g</text>
          <text fg={theme.textMuted}>group</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>m</text>
          <text fg={theme.textMuted}>move</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>d</text>
          <text fg={theme.textMuted}>delete</text>
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
          <text fg={theme.text}>z</text>
          <text fg={theme.textMuted}>hibernate</text>
        </box>
        <Show when={selectedSession()?.status === "waiting"}>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.warning}>y</text>
            <text fg={theme.warning}>confirm</text>
          </box>
        </Show>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>o</text>
          <text fg={theme.textMuted}>recents</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>s</text>
          <text fg={theme.textMuted}>shortcuts</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>c</text>
          <text fg={theme.textMuted}>settings</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>q</text>
          <text fg={theme.textMuted}>quit</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>?</text>
          <text fg={theme.textMuted}>help</text>
        </box>
        <Show when={updateInfo()}>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.success}>u</text>
            <text fg={theme.success}>update</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
