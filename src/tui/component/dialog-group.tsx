/**
 * Create/Rename group dialog
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
import type { Group } from "@/core/types"

interface DialogGroupProps {
  mode: "create" | "rename"
  group?: Group  // Required for rename mode
}

export function DialogGroup(props: DialogGroupProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [name, setName] = createSignal(props.mode === "rename" ? props.group?.name || "" : "")
  const [saving, setSaving] = createSignal(false)

  let inputRef: InputRenderable | undefined

  function validate(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) {
      return "Name cannot be empty"
    }
    if (trimmed.includes("/")) {
      return "Name cannot contain /"
    }
    if (trimmed.length > 50) {
      return "Name is too long (max 50 characters)"
    }
    return null
  }

  async function handleSubmit() {
    if (saving()) return

    const newName = name().trim()
    const error = validate(newName)

    if (error) {
      toast.show({ message: error, variant: "error", duration: 2000 })
      return
    }

    setSaving(true)

    try {
      if (props.mode === "create") {
        sync.group.create(newName)
        toast.show({ message: `Created group "${newName}"`, variant: "success", duration: 2000 })
      } else if (props.mode === "rename" && props.group) {
        if (newName === props.group.name) {
          dialog.clear()
          return
        }
        sync.group.rename(props.group.path, newName)
        toast.show({ message: `Renamed to "${newName}"`, variant: "success", duration: 2000 })
      }
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
      handleSubmit()
    }
  })

  const dialogTitle = props.mode === "create" ? "Create Group" : "Rename Group"
  const buttonText = props.mode === "create" ? "Create" : "Rename"

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={dialogTitle} />

      {/* Name field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.primary}>Group Name</text>
        <input
          value={name()}
          onInput={setName}
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
        label={buttonText}
        loadingLabel="Saving..."
        loading={saving()}
        onAction={handleSubmit}
      />

      <DialogFooter hint="Enter: save | Esc: cancel" />
    </box>
  )
}
