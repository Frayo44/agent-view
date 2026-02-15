/**
 * Dialog system
 * Based on OpenCode's dialog
 */

import { createContext, useContext, type ParentProps, type JSX, Show, batch, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { RGBA, Renderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import fs from "fs"
import path from "path"
import os from "os"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [DIALOG] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

export function Dialog(props: ParentProps<{ onClose: () => void; size?: "medium" | "large" }>) {
  log("Dialog component rendering")
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  log("Dialog dimensions:", dimensions().width, "x", dimensions().height)

  let dismiss = false

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection()
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      paddingTop={Math.floor(dimensions().height / 4)}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e) => {
          dismiss = false
          e.stopPropagation()
        }}
        width={props.size === "large" ? 80 : 60}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

interface DialogStackItem {
  element: () => JSX.Element
  onClose?: () => void
}

interface DialogState {
  stack: DialogStackItem[]
  size: "medium" | "large"
}

export interface DialogContext {
  clear(): void
  replace(element: () => JSX.Element, onClose?: () => void): void
  push(element: () => JSX.Element, onClose?: () => void): void
  pop(): void
  stack: DialogStackItem[]
  size: "medium" | "large"
  setSize(size: "medium" | "large"): void
}

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const [state, setState] = createStore<DialogState>({
    stack: [],
    size: "medium"
  })

  const renderer = useRenderer()
  let focus: Renderable | null

  function refocus() {
    setTimeout(() => {
      if (!focus || focus.isDestroyed) return
      focus.focus()
    }, 1)
  }

  useKeyboard((evt) => {
    if (state.stack.length === 0) return
    if (evt.defaultPrevented) return
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      if (renderer.getSelection()) return
      const current = state.stack.at(-1)!
      current.onClose?.()
      setState("stack", state.stack.slice(0, -1))
      evt.preventDefault()
      evt.stopPropagation()
      refocus()
    }
  })

  const value: DialogContext = {
    clear() {
      for (const item of state.stack) {
        item.onClose?.()
      }
      batch(() => {
        setState("size", "medium")
        setState("stack", [])
      })
      refocus()
    },
    replace(element: () => JSX.Element, onClose?: () => void) {
      log("Dialog.replace called, current stack length:", state.stack.length)
      if (state.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of state.stack) {
        item.onClose?.()
      }
      setState("size", "medium")
      // Store the factory function, don't call it - let it render in the tree
      setState("stack", [{ element, onClose }])
      log("Dialog.replace done, new stack length:", state.stack.length)
    },
    push(element: () => JSX.Element, onClose?: () => void) {
      if (state.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      // Store the factory function, don't call it
      setState("stack", [...state.stack, { element, onClose }])
    },
    pop() {
      const current = state.stack.at(-1)
      current?.onClose?.()
      setState("stack", state.stack.slice(0, -1))
      if (state.stack.length === 0) {
        refocus()
      }
    },
    get stack() {
      return state.stack
    },
    get size() {
      return state.size
    },
    setSize(size: "medium" | "large") {
      setState("size", size)
    }
  }

  // Debug: log stack changes only when it actually changes
  let lastStackLength = -1
  createEffect(() => {
    if (state.stack.length !== lastStackLength) {
      lastStackLength = state.stack.length
      log("Dialog stack changed to:", state.stack.length)
    }
  })

  return (
    <ctx.Provider value={value}>
      {props.children}
      {state.stack.length > 0 && (
        <>
          {log("Rendering Dialog overlay")}
          <Dialog onClose={() => value.clear()} size={state.size}>
            {state.stack.at(-1)!.element()}
          </Dialog>
        </>
      )}
    </ctx.Provider>
  )
}

export function useDialog(): DialogContext {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within DialogProvider")
  }
  return value
}
