/**
 * Update dialog
 * Shows current/latest version and allows updating
 */

import { createSignal } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import { performUpdateSync } from "@/core/updater"

interface DialogUpdateProps {
  current: string
  latest: string
}

export function DialogUpdate(props: DialogUpdateProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()

  const [updating, setUpdating] = createSignal(false)

  function handleUpdate() {
    if (updating()) return
    setUpdating(true)

    dialog.clear()
    renderer.suspend()

    try {
      performUpdateSync()
    } catch (err) {
      console.error("Update error:", err)
    }

    renderer.resume()
    toast.show({
      title: "Update complete",
      message: "Restart agent-view to use the new version",
      variant: "success",
      duration: 8000
    })
  }

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleUpdate()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Update Agent View" />

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1} flexDirection="column">
        <text fg={theme.text}>
          Current version: <span style={{ fg: theme.textMuted }}>v{props.current}</span>
        </text>
        <text fg={theme.text}>
          Latest version:  <span style={{ fg: theme.success }}>v{props.latest}</span>
        </text>
      </box>

      <ActionButton
        label="Update now"
        loadingLabel="Updating..."
        loading={updating()}
        onAction={handleUpdate}
      />

      <DialogFooter hint="Enter: update | Esc: cancel" />
    </box>
  )
}
