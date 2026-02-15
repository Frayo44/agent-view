/**
 * Theme context
 * Simplified version based on OpenCode's theme system
 */

import { RGBA } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export interface ThemeColors {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
}

export type Theme = ThemeColors

// Default themes
const themes: Record<string, Record<"dark" | "light", ThemeColors>> = {
  opencode: {
    dark: {
      primary: RGBA.fromHex("#fab283"),
      secondary: RGBA.fromHex("#89b4fa"),
      accent: RGBA.fromHex("#f9e2af"),
      error: RGBA.fromHex("#f38ba8"),
      warning: RGBA.fromHex("#f9e2af"),
      success: RGBA.fromHex("#a6e3a1"),
      info: RGBA.fromHex("#89b4fa"),
      text: RGBA.fromHex("#cdd6f4"),
      textMuted: RGBA.fromHex("#6c7086"),
      selectedListItemText: RGBA.fromHex("#1e1e2e"),
      background: RGBA.fromHex("#1e1e2e"),
      backgroundPanel: RGBA.fromHex("#313244"),
      backgroundElement: RGBA.fromHex("#45475a"),
      backgroundMenu: RGBA.fromHex("#313244"),
      border: RGBA.fromHex("#45475a"),
      borderActive: RGBA.fromHex("#fab283"),
      borderSubtle: RGBA.fromHex("#313244")
    },
    light: {
      primary: RGBA.fromHex("#fe640b"),
      secondary: RGBA.fromHex("#1e66f5"),
      accent: RGBA.fromHex("#df8e1d"),
      error: RGBA.fromHex("#d20f39"),
      warning: RGBA.fromHex("#df8e1d"),
      success: RGBA.fromHex("#40a02b"),
      info: RGBA.fromHex("#1e66f5"),
      text: RGBA.fromHex("#4c4f69"),
      textMuted: RGBA.fromHex("#9ca0b0"),
      selectedListItemText: RGBA.fromHex("#eff1f5"),
      background: RGBA.fromHex("#eff1f5"),
      backgroundPanel: RGBA.fromHex("#e6e9ef"),
      backgroundElement: RGBA.fromHex("#ccd0da"),
      backgroundMenu: RGBA.fromHex("#e6e9ef"),
      border: RGBA.fromHex("#ccd0da"),
      borderActive: RGBA.fromHex("#fe640b"),
      borderSubtle: RGBA.fromHex("#e6e9ef")
    }
  },
  catppuccin: {
    dark: {
      primary: RGBA.fromHex("#cba6f7"),
      secondary: RGBA.fromHex("#89b4fa"),
      accent: RGBA.fromHex("#f5c2e7"),
      error: RGBA.fromHex("#f38ba8"),
      warning: RGBA.fromHex("#fab387"),
      success: RGBA.fromHex("#a6e3a1"),
      info: RGBA.fromHex("#74c7ec"),
      text: RGBA.fromHex("#cdd6f4"),
      textMuted: RGBA.fromHex("#6c7086"),
      selectedListItemText: RGBA.fromHex("#1e1e2e"),
      background: RGBA.fromHex("#1e1e2e"),
      backgroundPanel: RGBA.fromHex("#313244"),
      backgroundElement: RGBA.fromHex("#45475a"),
      backgroundMenu: RGBA.fromHex("#313244"),
      border: RGBA.fromHex("#45475a"),
      borderActive: RGBA.fromHex("#cba6f7"),
      borderSubtle: RGBA.fromHex("#313244")
    },
    light: {
      primary: RGBA.fromHex("#8839ef"),
      secondary: RGBA.fromHex("#1e66f5"),
      accent: RGBA.fromHex("#ea76cb"),
      error: RGBA.fromHex("#d20f39"),
      warning: RGBA.fromHex("#fe640b"),
      success: RGBA.fromHex("#40a02b"),
      info: RGBA.fromHex("#04a5e5"),
      text: RGBA.fromHex("#4c4f69"),
      textMuted: RGBA.fromHex("#9ca0b0"),
      selectedListItemText: RGBA.fromHex("#eff1f5"),
      background: RGBA.fromHex("#eff1f5"),
      backgroundPanel: RGBA.fromHex("#e6e9ef"),
      backgroundElement: RGBA.fromHex("#ccd0da"),
      backgroundMenu: RGBA.fromHex("#e6e9ef"),
      border: RGBA.fromHex("#ccd0da"),
      borderActive: RGBA.fromHex("#8839ef"),
      borderSubtle: RGBA.fromHex("#e6e9ef")
    }
  },
  dracula: {
    dark: {
      primary: RGBA.fromHex("#bd93f9"),
      secondary: RGBA.fromHex("#8be9fd"),
      accent: RGBA.fromHex("#ff79c6"),
      error: RGBA.fromHex("#ff5555"),
      warning: RGBA.fromHex("#ffb86c"),
      success: RGBA.fromHex("#50fa7b"),
      info: RGBA.fromHex("#8be9fd"),
      text: RGBA.fromHex("#f8f8f2"),
      textMuted: RGBA.fromHex("#6272a4"),
      selectedListItemText: RGBA.fromHex("#282a36"),
      background: RGBA.fromHex("#282a36"),
      backgroundPanel: RGBA.fromHex("#44475a"),
      backgroundElement: RGBA.fromHex("#6272a4"),
      backgroundMenu: RGBA.fromHex("#44475a"),
      border: RGBA.fromHex("#6272a4"),
      borderActive: RGBA.fromHex("#bd93f9"),
      borderSubtle: RGBA.fromHex("#44475a")
    },
    light: {
      primary: RGBA.fromHex("#7c3aed"),
      secondary: RGBA.fromHex("#0891b2"),
      accent: RGBA.fromHex("#db2777"),
      error: RGBA.fromHex("#dc2626"),
      warning: RGBA.fromHex("#ea580c"),
      success: RGBA.fromHex("#16a34a"),
      info: RGBA.fromHex("#0891b2"),
      text: RGBA.fromHex("#1e293b"),
      textMuted: RGBA.fromHex("#64748b"),
      selectedListItemText: RGBA.fromHex("#f8fafc"),
      background: RGBA.fromHex("#f8fafc"),
      backgroundPanel: RGBA.fromHex("#e2e8f0"),
      backgroundElement: RGBA.fromHex("#cbd5e1"),
      backgroundMenu: RGBA.fromHex("#e2e8f0"),
      border: RGBA.fromHex("#cbd5e1"),
      borderActive: RGBA.fromHex("#7c3aed"),
      borderSubtle: RGBA.fromHex("#e2e8f0")
    }
  }
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }
  return theme.selectedListItemText
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode?: "dark" | "light" }) => {
    const [mode, setMode] = createSignal<"dark" | "light">(props.mode ?? "dark")
    const [selected, setSelected] = createSignal("opencode")

    const theme = createMemo<Theme>(() => {
      const themeDef = themes[selected()] ?? themes.opencode!
      return themeDef![mode()]
    })

    return {
      get theme() {
        return theme()
      },
      get selected() {
        return selected()
      },
      mode,
      setMode,
      set(name: string) {
        if (themes[name]) {
          setSelected(name)
        }
      },
      all() {
        return Object.keys(themes)
      }
    }
  }
})
