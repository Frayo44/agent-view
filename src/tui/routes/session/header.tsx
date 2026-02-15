/**
 * Session header bar
 */

import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import type { Session, SessionStatus } from "@/core/types"

const STATUS_LABELS: Record<SessionStatus, { icon: string; label: string }> = {
  running: { icon: "●", label: "Running" },
  waiting: { icon: "◐", label: "Waiting" },
  idle: { icon: "○", label: "Idle" },
  stopped: { icon: "◻", label: "Stopped" },
  error: { icon: "✗", label: "Error" }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function SessionHeader(props: { session: Session }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()

  const statusInfo = STATUS_LABELS[props.session.status]

  const statusColor = () => {
    switch (props.session.status) {
      case "running":
        return theme.success
      case "waiting":
        return theme.warning
      case "error":
        return theme.error
      default:
        return theme.textMuted
    }
  }

  return (
    <box
      flexDirection="row"
      width={dimensions().width}
      paddingLeft={2}
      paddingRight={2}
      height={1}
      backgroundColor={theme.backgroundPanel}
      justifyContent="space-between"
    >
      {/* Left: Title */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.session.title}
      </text>

      {/* Right: Status, tool, time */}
      <box flexDirection="row" gap={2}>
        <text>
          <span style={{ fg: statusColor() }}>{statusInfo.icon}</span>
          <span style={{ fg: theme.text }}> {statusInfo.label}</span>
        </text>
        <text fg={theme.textMuted}>{props.session.tool}</text>
        <text fg={theme.textMuted}>{formatTime(props.session.lastAccessed)}</text>
      </box>
    </box>
  )
}
