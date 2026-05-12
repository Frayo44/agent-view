/**
 * Settings dialog
 * Exposes all config.json settings in the TUI
 */

import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { getConfig, loadConfig, saveConfig } from "@/core/config"
import { setUserTmuxImport } from "@/core/tmux"
import type { Tool } from "@/core/types"

const TOOL_OPTIONS: { title: string; value: Tool }[] = [
  { title: "Claude Code", value: "claude" },
  { title: "OpenCode", value: "opencode" },
  { title: "Gemini CLI", value: "gemini" },
  { title: "Codex CLI", value: "codex" },
  { title: "Custom", value: "custom" },
  { title: "Shell", value: "shell" },
]

const HIBERNATE_OPTIONS = [
  { title: "Disabled", value: 0 },
  { title: "30 minutes", value: 30 },
  { title: "1 hour", value: 60 },
  { title: "2 hours", value: 120 },
  { title: "4 hours", value: 240 },
]

function formatHibernate(minutes: number): string {
  if (!minutes) return "Disabled"
  if (minutes < 60) return `${minutes}m`
  return `${minutes / 60}h`
}

export function DialogSettings() {
  const dialog = useDialog()
  const toast = useToast()
  const themeCtx = useTheme()
  const sync = useSync()

  function showSettingsList() {
    const config = getConfig()

    const options = [
      {
        title: "Default tool",
        value: "defaultTool" as const,
        footer: config.defaultTool || "claude",
      },
      {
        title: "Theme",
        value: "theme" as const,
        footer: `${themeCtx.selected} (${themeCtx.mode()})`,
      },
      {
        title: "Default group",
        value: "defaultGroup" as const,
        footer: config.defaultGroup || "default",
      },
      {
        title: "Auto-hibernate idle sessions",
        value: "autoHibernate" as const,
        footer: formatHibernate(config.autoHibernateMinutes || 0),
      },
      {
        title: "Import user tmux config",
        value: "importUserTmuxConfig" as const,
        footer: config.importUserTmuxConfig ? "On" : "Off",
      },
      {
        title: "Expand sidebar",
        value: "expandSidebar" as const,
        footer: config.expandSidebar ? "On" : "Off",
      },
    ]

    dialog.replace(() => (
      <DialogSelect
        title="Settings"
        options={options}
        skipFilter
        onSelect={(opt) => {
          switch (opt.value) {
            case "defaultTool": return showDefaultTool()
            case "theme": return showTheme()
            case "defaultGroup": return showDefaultGroup()
            case "autoHibernate": return showAutoHibernate()
            case "importUserTmuxConfig": return showImportUserTmuxConfig()
            case "expandSidebar": return showExpandSidebar()
          }
        }}
      />
    ))
  }

  async function updateConfig(updater: (config: Awaited<ReturnType<typeof loadConfig>>) => Awaited<ReturnType<typeof loadConfig>>) {
    const config = await loadConfig()
    await saveConfig(updater(config))
    toast.show({ message: "Setting saved", variant: "success", duration: 1500 })
    showSettingsList()
  }

  function showDefaultTool() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Default tool"
        options={TOOL_OPTIONS}
        current={config.defaultTool || "claude"}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, defaultTool: opt.value }))}
      />
    ))
  }

  function showTheme() {
    const themeNames = themeCtx.all()
    const modes = ["dark", "light"] as const

    const options = themeNames.flatMap((name) =>
      modes.map((mode) => ({
        title: `${name}`,
        value: { name, mode },
        description: mode,
      }))
    )

    const current = { name: themeCtx.selected, mode: themeCtx.mode() }
    dialog.replace(() => (
      <DialogSelect
        title="Theme"
        options={options}
        current={current}
        skipFilter
        onSelect={(opt) => {
          themeCtx.set(opt.value.name)
          themeCtx.setMode(opt.value.mode)
          updateConfig((c) => ({ ...c, theme: opt.value.name }))
        }}
      />
    ))
  }

  function showDefaultGroup() {
    const config = getConfig()
    const groups = sync.group.list()
    const options = groups.map((g) => ({
      title: g.name,
      value: g.path,
    }))
    dialog.replace(() => (
      <DialogSelect
        title="Default group"
        options={options}
        current={config.defaultGroup || "default"}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, defaultGroup: opt.value }))}
      />
    ))
  }

  function showAutoHibernate() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Auto-hibernate idle sessions"
        options={HIBERNATE_OPTIONS}
        current={config.autoHibernateMinutes || 0}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, autoHibernateMinutes: opt.value, autoHibernatePrompted: true }))}
      />
    ))
  }

  async function showImportUserTmuxConfig() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Import user tmux config"
        options={[
          { title: "Off (default)", value: false },
          { title: "On — source ~/.tmux.conf", value: true },
        ]}
        current={config.importUserTmuxConfig || false}
        skipFilter
        onSelect={async (opt) => {
          await setUserTmuxImport(opt.value)
          await updateConfig((c) => ({ ...c, importUserTmuxConfig: opt.value }))
        }}
      />
    ))
  }

  function showExpandSidebar() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Expand sidebar"
        options={[
          { title: "Off (default)", value: false },
          { title: "On — show all windows", value: true },
        ]}
        current={config.expandSidebar || false}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, expandSidebar: opt.value }))}
      />
    ))
  }

  // Show the settings list on mount
  showSettingsList()

  return <></>
}
