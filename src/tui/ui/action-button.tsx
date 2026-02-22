/**
 * Reusable action button for dialogs
 */

import { createSignal, createEffect, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

interface ActionButtonProps {
  label: string
  loadingLabel?: string
  loading?: boolean
  disabled?: boolean
  onAction: () => void
}

export function ActionButton(props: ActionButtonProps) {
  const { theme } = useTheme()
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)

  // Animate spinner when loading
  createEffect(() => {
    if (props.loading) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length)
      }, 80)
      onCleanup(() => clearInterval(interval))
    }
  })

  const isDisabled = () => props.loading || props.disabled

  const getButtonText = () => {
    if (props.loading) {
      const spinner = SPINNER_FRAMES[spinnerFrame()]
      const label = props.loadingLabel || "Loading..."
      return `${spinner} ${label}`
    }
    return props.label
  }

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
          {getButtonText()}
        </text>
      </box>
    </box>
  )
}
