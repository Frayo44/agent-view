/**
 * Shortcuts dialog - shows list of configured shortcuts for quick session creation
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
import { getShortcuts } from "@/core/config"
import { executeShortcut, getShortcutGroupPath } from "@/core/shortcut"
import { createListNavigation } from "@tui/util/navigation"
import type { Shortcut } from "@/core/types"

// Tool icons for display
const TOOL_ICONS: Record<string, string> = {
  claude: "\u2728",    // sparkles
  opencode: "\u2699",  // gear
  gemini: "\u2B50",    // star
  codex: "\u26A1",     // lightning
  custom: "\u2318",    // command
  shell: "\u276F"      // terminal
}

export function DialogShortcuts() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const shortcuts = getShortcuts()
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
    const len = shortcuts.length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  const move = createListNavigation(
    () => shortcuts.length,
    selectedIndex,
    setSelectedIndex
  )

  async function handleExecute(shortcut: Shortcut) {
    if (executing()) return
    setExecuting(true)
    setStatusMessage(`Creating ${shortcut.name}...`)

    try {
      const session = await executeShortcut({ shortcut })

      const groupPath = getShortcutGroupPath(shortcut)
      toast.show({
        message: `Created '${shortcut.name}' in ${groupPath} group`,
        variant: "success",
        duration: 2000
      })

      dialog.clear()
      sync.refresh()
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
      const shortcut = shortcuts[selectedIndex()]
      if (shortcut) {
        handleExecute(shortcut)
      }
      return
    }

    // Direct keybind execution (1-9 for direct shortcuts)
    if (/^[1-9]$/.test(evt.name)) {
      const index = parseInt(evt.name, 10) - 1
      const shortcut = shortcuts[index]
      if (shortcut) {
        handleExecute(shortcut)
      }
      return
    }
  })

  // No shortcuts configured
  if (shortcuts.length === 0) {
    return (
      <box gap={1} paddingBottom={1}>
        <DialogHeader title="Shortcuts" />

        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No shortcuts configured.</text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>
            Add shortcuts to ~/.agent-view/config.json
          </text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.accent}>Example:</text>
        </box>

        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>{`{
  "shortcuts": [{
    "name": "My Project",
    "tool": "claude",
    "projectPath": "/path/to/project",
    "groupPath": "work",
    "keybind": "1"
  }]
}`}</text>
        </box>
      </box>
    )
  }

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Shortcuts" />

      {/* Shortcuts list */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <For each={shortcuts}>
          {(shortcut, idx) => {
            const isSelected = () => idx() === selectedIndex()
            const toolIcon = TOOL_ICONS[shortcut.tool] || "\u25CF"

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
                  handleExecute(shortcut)
                }}
                onMouseOver={() => setSelectedIndex(idx())}
              >
                {/* Number hint */}
                <Show when={idx() < 9}>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                    {idx() + 1}
                  </text>
                </Show>
                <Show when={idx() >= 9}>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                    {" "}
                  </text>
                </Show>

                {/* Tool icon */}
                <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
                  {toolIcon}
                </text>

                {/* Name */}
                <text
                  fg={isSelected() ? theme.selectedListItemText : theme.text}
                  attributes={isSelected() ? TextAttributes.BOLD : undefined}
                >
                  {shortcut.name}
                </text>

                {/* Spacer */}
                <text flexGrow={1}> </text>

                {/* Group */}
                <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                  {shortcut.groupPath}
                </text>

                {/* Keybind hint */}
                <Show when={shortcut.keybind}>
                  <text> </text>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.info}>
                    [{shortcut.keybind}]
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>

      {/* Description of selected */}
      <Show when={shortcuts[selectedIndex()]?.description}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>
            {shortcuts[selectedIndex()]?.description}
          </text>
        </box>
      </Show>

      {/* Path of selected */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          {shortcuts[selectedIndex()]?.projectPath || ""}
        </text>
      </box>

      <DialogFooter
        hint={executing()
          ? `${spinnerFrames[spinnerFrame()]} ${statusMessage()}`
          : "\u2191\u2193 navigate | Enter execute | 1-9 quick select"}
      />
    </box>
  )
}
