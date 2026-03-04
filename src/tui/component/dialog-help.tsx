/**
 * Help dialog - shows all keyboard shortcuts
 */

import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"

interface ShortcutGroup {
  title: string
  shortcuts: { key: string; description: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { key: "j / \u2193", description: "Move down" },
      { key: "k / \u2191", description: "Move up" },
      { key: "PgDn", description: "Move down 10" },
      { key: "PgUp", description: "Move up 10" },
      { key: "Home", description: "Jump to start" },
      { key: "End", description: "Jump to end" },
      { key: "1-9", description: "Jump to group" },
    ]
  },
  {
    title: "Sessions",
    shortcuts: [
      { key: "Enter", description: "Attach / Toggle group" },
      { key: "n", description: "New session" },
      { key: "d", description: "Delete session/group" },
      { key: "r", description: "Restart session" },
      { key: "R", description: "Rename session/group" },
      { key: "f", description: "Fork session" },
      { key: "F", description: "Fork with options" },
      { key: "z", description: "Hibernate session" },
      { key: "m", description: "Move to group" },
    ]
  },
  {
    title: "Groups",
    shortcuts: [
      { key: "g", description: "Create new group" },
      { key: "h / \u2190", description: "Collapse group" },
      { key: "l / \u2192", description: "Expand group" },
    ]
  },
  {
    title: "Other",
    shortcuts: [
      { key: "s", description: "Session shortcuts" },
      { key: "o", description: "Open recent" },
      { key: "c", description: "Settings" },
      { key: "u", description: "Update (when available)" },
      { key: "?", description: "Show this help" },
      { key: "q", description: "Quit" },
    ]
  }
]

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "?" || evt.name === "q") {
      evt.preventDefault()
      dialog.clear()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Keyboard Shortcuts" />

      <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column" gap={1}>
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <box flexDirection="column">
              {/* Group title */}
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                {group.title}
              </text>

              {/* Shortcuts in this group */}
              <For each={group.shortcuts}>
                {(shortcut) => (
                  <box flexDirection="row" paddingLeft={2}>
                    <box width={14}>
                      <text fg={theme.text}>{shortcut.key}</text>
                    </box>
                    <text fg={theme.textMuted}>{shortcut.description}</text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </box>

      <DialogFooter hint="Press Esc or ? to close" />
    </box>
  )
}
