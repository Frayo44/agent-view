/**
 * Session footer bar
 */

import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import type { Session } from "@/core/types"

export function SessionFooter(props: { session: Session }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()

  const shortPath = props.session.projectPath.replace(process.env.HOME || "", "~")

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
      {/* Left: Project path */}
      <text fg={theme.textMuted}>{shortPath}</text>

      {/* Right: Keybind hints */}
      <box flexDirection="row" gap={2}>
        <text>
          <span style={{ fg: theme.textMuted }}>Ctrl+K</span>
          <span style={{ fg: theme.text }}> commands</span>
        </text>
        <text>
          <span style={{ fg: theme.textMuted }}>q</span>
          <span style={{ fg: theme.text }}> detach</span>
        </text>
        <text>
          <span style={{ fg: theme.textMuted }}>?</span>
          <span style={{ fg: theme.text }}> help</span>
        </text>
        <text fg={theme.textMuted}>v1.0.0</text>
      </box>
    </box>
  )
}
