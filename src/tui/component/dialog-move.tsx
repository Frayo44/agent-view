/**
 * Move session to group dialog
 */

import { createSignal, createMemo, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ensureDefaultGroup, DEFAULT_GROUP_PATH } from "@tui/util/groups"
import { createListNavigation } from "@tui/util/navigation"
import type { Session } from "@/core/types"

interface DialogMoveProps {
  session: Session
}

export function DialogMove(props: DialogMoveProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  // Get available groups
  const groups = createMemo(() => {
    return ensureDefaultGroup(sync.group.list()).sort((a, b) => a.order - b.order)
  })

  // Current group
  const currentGroupPath = props.session.groupPath || DEFAULT_GROUP_PATH

  // Selection state
  const [selectedIndex, setSelectedIndex] = createSignal(
    Math.max(0, groups().findIndex(g => g.path === currentGroupPath))
  )

  const move = createListNavigation(
    () => groups().length,
    selectedIndex,
    setSelectedIndex
  )

  function handleSelect() {
    const group = groups()[selectedIndex()]
    if (!group) return

    // Don't move if already in this group
    if (group.path === currentGroupPath) {
      dialog.clear()
      return
    }

    try {
      sync.session.moveToGroup(props.session.id, group.path)
      toast.show({ message: `Moved to "${group.name}"`, variant: "success", duration: 2000 })
      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      move(-1)
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      move(1)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      handleSelect()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Move Session" />

      {/* Session info */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          Moving "{props.session.title}" to:
        </text>
      </box>

      {/* Group list */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column">
        <For each={groups()}>
          {(group, index) => {
            const isSelected = () => index() === selectedIndex()
            const isCurrent = group.path === currentGroupPath

            return (
              <box
                flexDirection="row"
                height={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isSelected() ? theme.primary : undefined}
                onMouseUp={() => {
                  setSelectedIndex(index())
                  handleSelect()
                }}
                onMouseOver={() => setSelectedIndex(index())}
              >
                {/* Selection indicator */}
                <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                  {isSelected() ? ">" : " "}
                </text>
                <text> </text>

                {/* Group name */}
                <text
                  fg={isSelected() ? theme.selectedListItemText : theme.text}
                  attributes={isSelected() ? TextAttributes.BOLD : undefined}
                >
                  {group.name}
                </text>

                {/* Current indicator */}
                <Show when={isCurrent}>
                  <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
                    {" (current)"}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>

      <DialogFooter hint="j/k: navigate | Enter: select | Esc: cancel" />
    </box>
  )
}
