/**
 * Reusable action button for dialogs
 */

import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

interface ActionButtonProps {
  label: string
  loadingLabel?: string
  loading?: boolean
  disabled?: boolean
  onAction: () => void
}

export function ActionButton(props: ActionButtonProps) {
  const { theme } = useTheme()

  const isDisabled = () => props.loading || props.disabled

  return (
    <box paddingLeft={4} paddingRight={4} paddingTop={2}>
      <box
        backgroundColor={isDisabled() ? theme.backgroundElement : theme.primary}
        padding={1}
        onMouseUp={isDisabled() ? undefined : props.onAction}
        alignItems="center"
      >
        <text
          fg={props.disabled ? theme.textMuted : theme.selectedListItemText}
          attributes={TextAttributes.BOLD}
        >
          {props.loading ? (props.loadingLabel || "Loading...") : props.label}
        </text>
      </box>
    </box>
  )
}
