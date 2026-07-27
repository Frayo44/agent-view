/**
 * Settings dialog
 * Exposes all config.json settings in the TUI
 */

import { useRenderer } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { getConfig, loadConfig, saveConfig } from "@/core/config"

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
  const renderer = useRenderer()

  function showSettingsList() {
    const config = getConfig()

    const options = [
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
        title: "Notifications",
        value: "notifications" as const,
        footer: config.notifications !== false ? "Enabled" : "Disabled",
      },
      {
        title: "Mouse support",
        value: "mouse" as const,
        footer: config.mouse !== false ? "Enabled" : "Disabled (keyboard-only)",
      },
    ]

    dialog.replace(() => (
      <DialogSelect
        title="Settings"
        options={options}
        skipFilter
        onSelect={(opt) => {
          switch (opt.value) {
            case "theme": return showTheme()
            case "defaultGroup": return showDefaultGroup()
            case "autoHibernate": return showAutoHibernate()
            case "notifications": return showNotifications()
            case "mouse": return showMouse()
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

  function showMouse() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Mouse support"
        options={[
          { title: "Enabled", value: true },
          { title: "Disabled (keyboard-only)", value: false },
        ]}
        current={config.mouse !== false}
        skipFilter
        onSelect={(opt) => {
          renderer.useMouse = opt.value
          updateConfig((c) => ({ ...c, mouse: opt.value }))
        }}
      />
    ))
  }

  function showNotifications() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Notifications (when agents finish or need input)"
        options={[
          { title: "Enabled", value: true },
          { title: "Disabled", value: false },
        ]}
        current={config.notifications !== false}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, notifications: opt.value }))}
      />
    ))
  }

  // Show the settings list on mount
  showSettingsList()

  return <></>
}
