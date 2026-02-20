/**
 * Reusable dialog header with title and escape hint
 */

import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"

interface DialogHeaderProps {
  title: string
}

export function DialogHeader(props: DialogHeaderProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={4} paddingRight={4}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
    </box>
  )
}
