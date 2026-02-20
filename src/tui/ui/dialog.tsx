/**
 * Dialog system with adaptive scrolling for small terminals
 */

import { createContext, useContext, type ParentProps, type JSX, batch, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { RGBA, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

// Shared signal for dialog scroll ref (allows DialogProvider to control scrolling)
const [dialogScrollRef, setDialogScrollRef] = createSignal<ScrollBoxRenderable | undefined>(undefined)

/**
 * Scroll the dialog content by a delta amount
 */
export function scrollDialogBy(delta: number) {
  const ref = dialogScrollRef()
  if (ref) {
    ref.scrollBy(delta)
  }
}

/**
 * Scroll the dialog content to an absolute position
 */
export function scrollDialogTo(position: number) {
  const ref = dialogScrollRef()
  if (ref) {
    ref.scrollTo(position)
  }
}

// Threshold for enabling scroll mode (terminal height in rows)
const SCROLL_MODE_THRESHOLD = 30

export function Dialog(props: ParentProps<{ onClose: () => void; size?: "medium" | "large" }>) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false

  // Calculate dialog dimensions based on terminal size
  const termWidth = dimensions().width
  const termHeight = dimensions().height

  // Dialog width: target width capped by terminal width
  const targetWidth = props.size === "large" ? 80 : 60
  const dialogWidth = Math.min(targetWidth, termWidth - 4)

  // Dialog height for scroll mode: leave small margin
  const verticalMargin = Math.max(1, Math.floor(termHeight * 0.05))
  const scrollHeight = Math.max(5, termHeight - (verticalMargin * 2))

  // Use scroll mode for small terminals
  const useScrollMode = termHeight < SCROLL_MODE_THRESHOLD

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
      width={termWidth}
      height={termHeight}
      alignItems="center"
      justifyContent="center"
      position="absolute"
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e) => {
          dismiss = false
          e.stopPropagation()
        }}
        width={dialogWidth}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {useScrollMode ? (
          <scrollbox
            ref={(r: ScrollBoxRenderable) => { setDialogScrollRef(r) }}
            height={scrollHeight}
            scrollbarOptions={{ visible: false }}
          >
            {props.children}
          </scrollbox>
        ) : (
          props.children
        )}
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

    // Handle dialog scrolling with [ and ]
    const scrollRef = dialogScrollRef()
    if (scrollRef) {
      if (evt.name === "[") {
        scrollRef.scrollBy(-3)
        evt.preventDefault()
        return
      }
      if (evt.name === "]") {
        scrollRef.scrollBy(3)
        evt.preventDefault()
        return
      }
    }

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
      if (state.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of state.stack) {
        item.onClose?.()
      }
      setState("size", "medium")
      setState("stack", [{ element, onClose }])
    },
    push(element: () => JSX.Element, onClose?: () => void) {
      if (state.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
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

  return (
    <ctx.Provider value={value}>
      {props.children}
      {state.stack.length > 0 && (
        <Dialog onClose={() => value.clear()} size={state.size}>
          {state.stack.at(-1)!.element()}
        </Dialog>
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
