/**
 * Rename session dialog
 */

import { createSignal } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
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
      <DialogHeader title="Rename Session" />

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

      <ActionButton
        label="Rename"
        loadingLabel="Saving..."
        loading={saving()}
        onAction={handleRename}
      />

      <DialogFooter hint="Enter: save | Esc: cancel" />
    </box>
  )
}
