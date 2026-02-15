/**
 * Toast notification system
 * Based on OpenCode's toast
 */

import { createContext, useContext, type ParentProps, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { TextAttributes, RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"

export interface Toast {
  id: string
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
}

interface ToastState {
  toasts: Toast[]
}

interface ToastContext {
  show(options: Omit<Toast, "id"> | string): void
  error(err: Error | string): void
  dismiss(id: string): void
}

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const [state, setState] = createStore<ToastState>({
    toasts: []
  })

  let nextId = 0

  function show(options: Omit<Toast, "id"> | string): void {
    const toast: Toast =
      typeof options === "string"
        ? { id: String(nextId++), message: options, variant: "info", duration: 3000 }
        : { ...options, id: String(nextId++) }

    setState(
      produce((draft) => {
        draft.toasts.push(toast)
      })
    )

    if (toast.duration > 0) {
      setTimeout(() => {
        dismiss(toast.id)
      }, toast.duration)
    }
  }

  function error(err: Error | string): void {
    const message = err instanceof Error ? err.message : err
    show({ message, variant: "error", duration: 5000 })
  }

  function dismiss(id: string): void {
    setState(
      produce((draft) => {
        draft.toasts = draft.toasts.filter((t) => t.id !== id)
      })
    )
  }

  const value: ToastContext = { show, error, dismiss }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <ToastContainer toasts={state.toasts} onDismiss={dismiss} />
    </ctx.Provider>
  )
}

export function useToast(): ToastContext {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return value
}

function ToastContainer(props: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()

  const variantColors = {
    info: theme.info,
    success: theme.success,
    warning: theme.warning,
    error: theme.error
  }

  return (
    <Show when={props.toasts.length > 0}>
      <box
        position="absolute"
        right={2}
        top={1}
        flexDirection="column"
        gap={1}
      >
        <For each={props.toasts}>
          {(toast) => (
            <box
              backgroundColor={theme.backgroundPanel}
              padding={1}
              width={40}
              onMouseUp={() => props.onDismiss(toast.id)}
            >
              <box flexDirection="column" gap={0}>
                <Show when={toast.title}>
                  <text
                    fg={variantColors[toast.variant]}
                    attributes={TextAttributes.BOLD}
                  >
                    {toast.title}
                  </text>
                </Show>
                <text fg={theme.text}>{toast.message}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
