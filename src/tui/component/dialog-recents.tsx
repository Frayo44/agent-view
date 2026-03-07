/**
 * Recents dialog - shows list of auto-saved recent sessions for quick recreation
 */

import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { getRecents } from "@/core/config"
import { SSHRunner } from "@/core/ssh"
import { createListNavigation } from "@tui/util/navigation"
import type { Recent } from "@/core/types"

// Tool icons for display
const TOOL_ICONS: Record<string, string> = {
  claude: "\u2728",    // sparkles
  opencode: "\u2699",  // gear
  gemini: "\u2B50",    // star
  codex: "\u26A1",     // lightning
  custom: "\u2318",    // command
  shell: "\u276F"      // terminal
}

export function DialogRecents() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const recents = getRecents()
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [executing, setExecuting] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal("")
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)

  // Spinner animation
  const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]

  createEffect(() => {
    if (executing()) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % spinnerFrames.length)
      }, 80)
      onCleanup(() => clearInterval(interval))
    }
  })

  // Keep selection in bounds
  createEffect(() => {
    const len = recents.length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  const move = createListNavigation(
    () => recents.length,
    selectedIndex,
    setSelectedIndex
  )

  async function handleExecute(recent: Recent) {
    if (executing()) return
    setExecuting(true)

    const isRemote = !!recent.remoteHost
    setStatusMessage(`Creating ${isRemote ? "remote " : ""}session from ${recent.name}...`)

    try {
      if (isRemote) {
        // Create remote session
        const runner = new SSHRunner("remote", recent.remoteHost!, recent.remoteAvPath || "av")
        const result = await runner.create({
          title: recent.name,
          projectPath: recent.projectPath,
          tool: recent.tool,
          command: recent.command,
        })

        if (result.success) {
          toast.show({
            message: `Created session on ${recent.remoteHost}`,
            variant: "success",
            duration: 2000
          })
          dialog.clear()
          sync.refreshRemote()
        } else {
          toast.show({
            message: result.error || "Failed to create remote session",
            variant: "error",
            duration: 3000
          })
        }
      } else {
        // Create local session
        // Ensure group exists (create if missing)
        if (recent.groupPath) {
          const existingGroups = sync.group.list()
          const groupExists = existingGroups.some(g => g.path === recent.groupPath)
          if (!groupExists) {
            sync.group.create(recent.groupPath)
          }
        }

        const session = await sync.session.create({
          title: recent.name,
          projectPath: recent.projectPath,
          tool: recent.tool,
          groupPath: recent.groupPath,
          claudeOptions: { sessionMode: "new" }  // Always start fresh
        })

        toast.show({
          message: `Created session '${session.title}'`,
          variant: "success",
          duration: 2000
        })

        dialog.clear()
        sync.refresh()
      }
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setExecuting(false)
      setStatusMessage("")
    }
  }

  useKeyboard((evt) => {
    // ESC to close
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }

    // Navigation
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      move(-1)
      return
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      move(1)
      return
    }

    // Enter to execute selected
    if (evt.name === "return") {
      evt.preventDefault()
      const recent = recents[selectedIndex()]
      if (recent) {
        handleExecute(recent)
      }
      return
    }

  })

  // No recents saved yet
  if (recents.length === 0) {
    return (
      <box gap={1} paddingBottom={1}>
        <DialogHeader title="Recents" />

        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No recents yet.</text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>
            Recents are automatically saved when you create sessions.
          </text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row">
          <text fg={theme.text}>Press </text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>n</text>
          <text fg={theme.text}> to create a new session.</text>
        </box>
      </box>
    )
  }

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Recents" />

      {/* Recents list */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <For each={recents}>
          {(recent, idx) => {
            const isSelected = () => idx() === selectedIndex()
            const toolIcon = TOOL_ICONS[recent.tool] || "\u25CF"

            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                height={1}
                backgroundColor={isSelected() ? theme.primary : undefined}
                onMouseUp={() => {
                  setSelectedIndex(idx())
                  handleExecute(recent)
                }}
                onMouseOver={() => setSelectedIndex(idx())}
              >
                {/* Tool icon */}
                <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
                  {toolIcon}
                </text>

                {/* Name */}
                <text
                  fg={isSelected() ? theme.selectedListItemText : theme.text}
                  attributes={isSelected() ? TextAttributes.BOLD : undefined}
                >
                  {recent.name}
                </text>

                {/* Remote indicator */}
                <Show when={recent.remoteHost}>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.info}>
                    {" "}@{recent.remoteHost}
                  </text>
                </Show>

                {/* Spacer */}
                <text flexGrow={1}> </text>

                {/* Group */}
                <Show when={recent.groupPath && !recent.remoteHost}>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                    {recent.groupPath}
                  </text>
                  <text> </text>
                </Show>

                {/* Tool name */}
                <text fg={isSelected() ? theme.selectedListItemText : theme.info}>
                  {recent.tool}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      {/* Path of selected */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          {recents[selectedIndex()]?.projectPath || ""}
        </text>
      </box>

      <DialogFooter
        hint={executing()
          ? `${spinnerFrames[spinnerFrame()]} ${statusMessage()}`
          : "\u2191\u2193 navigate | Enter execute"}
      />
    </box>
  )
}
