/**
 * Main TUI application
 * Provider hierarchy and routing
 */

import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { CliRenderer } from "@opentui/core"
import fs from "fs"
import path from "path"
import os from "os"

// File logger for debugging
const logDir = path.join(os.homedir(), ".agent-orchestrator")
const logFile = path.join(logDir, "debug.log")
fs.mkdirSync(logDir, { recursive: true })
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  fs.appendFileSync(logFile, msg)
}
import { Switch, Match, createEffect, ErrorBoundary, Show, onMount } from "solid-js"
import { RouteProvider, useRoute } from "@tui/context/route"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { KVProvider, useKV } from "@tui/context/kv"
import { ConfigProvider } from "@tui/context/config"
import { loadConfig } from "@/core/config"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { ToastProvider, useToast } from "@tui/ui/toast"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogSessions } from "@tui/component/dialog-sessions"
import { DialogNew } from "@tui/component/dialog-new"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { getStorage, setStorage, Storage } from "@/core/storage"
import { isTmuxAvailable } from "@/core/tmux"

async function detectTerminalMode(): Promise<"dark" | "light"> {
  // Simple detection - could be enhanced
  return "dark"
}

export interface TuiOptions {
  mode?: "dark" | "light"
  onExit?: () => Promise<void>
}

export async function tui(options: TuiOptions = {}) {
  log("=== Agent Orchestrator starting ===")

  // Check tmux availability
  const tmuxOk = await isTmuxAvailable()
  if (!tmuxOk) {
    console.error("Error: tmux is not available. Please install tmux first.")
    process.exit(1)
  }

  // Initialize storage
  const storage = new Storage()
  storage.migrate()
  setStorage(storage)

  // Load config from ~/.agent-view/config.json
  await loadConfig()

  const mode = options.mode ?? (await detectTerminalMode())

  return new Promise<void>((resolve) => {
    let rendererRef: CliRenderer | null = null

    const onExit = async () => {
      try {
        storage.close()
        await options.onExit?.()
      } catch (e) {
        // Ignore cleanup errors
      }

      // Delegate full terminal cleanup to OpenTUI's renderer (disables mouse
      // tracking, kitty keyboard, bracketed paste, alternate screen, etc.)
      rendererRef?.destroy()

      resolve()
      process.exit(0)
    }

    render(
      () => (
        <ErrorBoundary fallback={(error: Error) => <ErrorComponent error={error} onRendererReady={(r) => { rendererRef = r }} />}>
          <KVProvider>
            <ConfigProvider>
              <RouteProvider>
                <SyncProvider>
                  <ThemeProvider mode={mode}>
                    <ToastProvider>
                      <KeybindProvider>
                        <DialogProvider>
                          <CommandProvider>
                            <App onExit={onExit} onRendererReady={(r) => { rendererRef = r }} />
                          </CommandProvider>
                        </DialogProvider>
                      </KeybindProvider>
                    </ToastProvider>
                  </ThemeProvider>
                </SyncProvider>
              </RouteProvider>
            </ConfigProvider>
          </KVProvider>
        </ErrorBoundary>
      ),
      {
        targetFps: 60,
        exitOnCtrlC: false,
        autoFocus: false,
        useKittyKeyboard: {},
        openConsoleOnError: true
      }
    )
  })
}

function App(props: { onExit: () => Promise<void>; onRendererReady: (r: CliRenderer) => void }) {
  log("App component rendering")
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const dialog = useDialog()
  const command = useCommandDialog()
  const sync = useSync()
  const toast = useToast()
  const keybind = useKeybind()
  const renderer = useRenderer()

  log("App initialized, route:", route.data.type, "dimensions:", dimensions().width, "x", dimensions().height)

  // Disable stdout interception to allow keyboard input
  onMount(() => {
    renderer.disableStdoutInterception()
    props.onRendererReady(renderer)
  })

  // Register global commands
  onMount(() => {
    command.register(() => [
      {
        title: "Switch session",
        value: "session.list",
        category: "Session",
        keybind: "Ctrl+L",
        suggested: sync.data.sessions.length > 0,
        onSelect: () => {
          dialog.replace(() => <DialogSessions />)
        }
      },
      {
        title: "New session",
        value: "session.new",
        category: "Session",
        keybind: "N",
        suggested: true,
        onSelect: () => {
          dialog.replace(() => <DialogNew />)
        }
      },
      {
        title: "Go home",
        value: "nav.home",
        category: "Navigation",
        onSelect: () => {
          route.navigate({ type: "home" })
          dialog.clear()
        }
      },
      {
        title: "Exit",
        value: "app.exit",
        category: "System",
        keybind: "Q",
        onSelect: async () => {
          await props.onExit()
        }
      }
    ])
  })

  useKeyboard((evt) => {
    log("App useKeyboard:", evt.name, "ctrl:", evt.ctrl)

    if (dialog.stack.length > 0) return

    if (evt.ctrl && evt.name === "c") {
      props.onExit()
    }

    if (evt.ctrl && evt.name === "k") {
      command.open()
    }

    if (evt.name === "n") {
      evt.preventDefault()
      log("Opening new dialog from App")
      dialog.replace(() => <DialogNew />)
    }

    if (evt.name === "l") {
      log("Opening sessions dialog from App")
      dialog.replace(() => <DialogSessions />)
    }

    if (evt.name === "q") {
      props.onExit()
    }

    if (evt.name === "?") {
      toast.show({
        title: "Help",
        message: "Ctrl+K: Commands | L: Sessions | N: New | Q: Quit",
        variant: "info",
        duration: 5000
      })
    }
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
    </box>
  )
}

function ErrorComponent(props: { error: Error; onRendererReady: (r: CliRenderer) => void }) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  onMount(() => {
    props.onRendererReady(renderer)
  })

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      renderer.destroy()
      process.exit(1)
    }
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor="#1e1e2e"
      flexDirection="column"
      padding={2}
      gap={1}
    >
      <text fg="#f38ba8" attributes={0x01}>
        Fatal Error
      </text>
      <text fg="#cdd6f4">{props.error.message}</text>
      <text fg="#6c7086">{props.error.stack}</text>
      <text fg="#6c7086">Press Ctrl+C to exit</text>
    </box>
  )
}
