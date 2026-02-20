/**
 * Reusable dialog footer with keybind hints
 */

import { useTheme } from "@tui/context/theme"

interface DialogFooterProps {
  hint: string
}

export function DialogFooter(props: DialogFooterProps) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={4} paddingRight={4} paddingTop={1}>
      <text fg={theme.textMuted}>{props.hint}</text>
    </box>
  )
}
