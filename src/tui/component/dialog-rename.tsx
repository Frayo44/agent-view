/**
 * Rename session dialog
 */

import { createSignal } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import type { Session } from "@/core/types"

interface DialogRenameProps {
  session: Session
}

export function DialogRename(props: DialogRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [title, setTitle] = createSignal(props.session.title)
  const [saving, setSaving] = createSignal(false)

  let inputRef: InputRenderable | undefined

  async function handleRename() {
    if (saving()) return

    const newTitle = title().trim()
    if (!newTitle) {
      toast.show({ message: "Title cannot be empty", variant: "error", duration: 2000 })
      return
    }

    if (newTitle === props.session.title) {
      dialog.clear()
      return
    }

    setSaving(true)

    try {
      sync.session.rename(props.session.id, newTitle)
      toast.show({ message: `Renamed to "${newTitle}"`, variant: "success", duration: 2000 })
      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setSaving(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleRename()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Rename Session
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.primary}>New Title</text>
        <input
          value={title()}
          onInput={setTitle}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      {/* Rename button */}
      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={saving() ? theme.backgroundElement : theme.primary}
          padding={1}
          onMouseUp={handleRename}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {saving() ? "Saving..." : "Rename"}
          </text>
        </box>
      </box>

      {/* Footer */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Enter: save | Esc: cancel</text>
      </box>
    </box>
  )
}
