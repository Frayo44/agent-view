/**
 * Keybind context
 * Based on OpenCode's keybind system
 */

import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createSimpleContext } from "./helper"

export interface KeybindInfo {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  leader: boolean
}

export type KeybindConfig = Record<string, string | string[]>

// Default keybindings
const DEFAULT_KEYBINDS: KeybindConfig = {
  leader: "\\",
  session_list: ["ctrl+l", "<leader>l"],
  session_new: ["ctrl+n", "<leader>n"],
  command_palette: ["ctrl+k", "<leader>k"],
  help: ["?", "<leader>h"],
  quit: ["ctrl+q", "<leader>q"],
  detach: ["q", "escape"],
  delete: ["d", "ctrl+d"],
  restart: ["r", "ctrl+r"],
  fork: ["f", "ctrl+f"]
}

export function parseKeybind(str: string): KeybindInfo {
  const lower = str.toLowerCase()
  const hasLeader = lower.startsWith("<leader>")
  const withoutLeader = hasLeader ? lower.slice(8) : lower

  const parts = withoutLeader.split("+")
  const key = parts.pop() || ""

  return {
    key,
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    leader: hasLeader
  }
}

export function matchKeybind(info: KeybindInfo, evt: ParsedKey, leaderActive: boolean): boolean {
  if (info.leader && !leaderActive) return false
  if (info.ctrl !== (evt.ctrl ?? false)) return false
  if (info.alt !== (evt.meta ?? false)) return false
  if (info.shift !== (evt.shift ?? false)) return false

  const evtKey = evt.name?.toLowerCase() || ""
  return info.key === evtKey
}

export function keybindToString(info: KeybindInfo): string {
  const parts: string[] = []
  if (info.leader) parts.push("<leader>")
  if (info.ctrl) parts.push("ctrl")
  if (info.alt) parts.push("alt")
  if (info.shift) parts.push("shift")
  parts.push(info.key)
  return parts.join("+")
}

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const [store, setStore] = createStore({
      leader: false,
      config: DEFAULT_KEYBINDS as KeybindConfig
    })

    const renderer = useRenderer()
    let focus: Renderable | null
    let timeout: NodeJS.Timeout

    function setLeader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        focus?.blur()

        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          setLeader(false)
          if (focus && !focus.isDestroyed) {
            focus.focus()
          }
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    const leaderKey = createMemo(() => {
      const config = store.config.leader
      if (!config) return null
      const str = Array.isArray(config) ? config[0] : config
      if (!str) return null
      return parseKeybind(str)
    })

    useKeyboard(async (evt) => {
      const leader = leaderKey()
      if (leader && !store.leader && matchKeybind(leader, evt, false)) {
        setLeader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && renderer.currentFocusedRenderable === focus) {
            focus.focus()
          }
          setLeader(false)
        })
      }
    })

    return {
      get all() {
        return store.config
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): KeybindInfo {
        return {
          key: evt.name?.toLowerCase() || "",
          ctrl: evt.ctrl ?? false,
          alt: evt.meta ?? false,
          shift: evt.shift ?? false,
          leader: store.leader
        }
      },
      match(key: keyof typeof DEFAULT_KEYBINDS, evt: ParsedKey): boolean {
        const config = store.config[key]
        if (!config) return false

        const bindings = Array.isArray(config) ? config : [config]
        const parsed = this.parse(evt)

        for (const binding of bindings) {
          const info = parseKeybind(binding)
          if (matchKeybind(info, evt, store.leader)) {
            return true
          }
        }
        return false
      },
      print(key: keyof typeof DEFAULT_KEYBINDS): string {
        const config = store.config[key]
        if (!config) return ""
        const first = Array.isArray(config) ? config[0] : config
        if (!first) return ""
        return first.replace("<leader>", store.config.leader as string ?? "")
      },
      setConfig(config: KeybindConfig) {
        setStore("config", { ...DEFAULT_KEYBINDS, ...config })
      }
    }
  }
})
