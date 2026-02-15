/**
 * Command palette dialog
 * Central command registration and execution
 */

import { createContext, useContext, type ParentProps, createMemo, For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"

export interface Command {
  title: string
  value: string
  category?: string
  keybind?: string
  suggested?: boolean
  hidden?: boolean
  slash?: {
    name: string
    aliases?: string[]
  }
  onSelect: (dialog: ReturnType<typeof useDialog>) => void
}

interface CommandState {
  commands: Command[]
}

interface CommandContext {
  register(provider: () => Command[]): () => void
  trigger(value: string): void
  open(): void
}

const ctx = createContext<CommandContext>()

export function CommandProvider(props: ParentProps) {
  const dialog = useDialog()
  const [state, setState] = createStore<CommandState>({
    commands: []
  })

  const providers: Set<() => Command[]> = new Set()

  function refreshCommands() {
    const commands: Command[] = []
    for (const provider of providers) {
      commands.push(...provider())
    }
    setState("commands", commands)
  }

  const value: CommandContext = {
    register(provider) {
      providers.add(provider)
      refreshCommands()
      return () => {
        providers.delete(provider)
        refreshCommands()
      }
    },
    trigger(cmdValue) {
      const cmd = state.commands.find((c) => c.value === cmdValue)
      if (cmd) {
        cmd.onSelect(dialog)
      }
    },
    open() {
      dialog.replace(() => <DialogCommand commands={state.commands} />)
    }
  }

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useCommandDialog(): CommandContext {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within CommandProvider")
  }
  return value
}

function DialogCommand(props: { commands: Command[] }) {
  const dialog = useDialog()

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const visible = props.commands.filter((c) => !c.hidden)

    // Sort: suggested first, then by category
    const sorted = [...visible].sort((a, b) => {
      if (a.suggested && !b.suggested) return -1
      if (!a.suggested && b.suggested) return 1
      return (a.category ?? "").localeCompare(b.category ?? "")
    })

    return sorted.map((cmd) => ({
      title: cmd.title,
      value: cmd.value,
      category: cmd.category,
      footer: cmd.keybind,
      onSelect: () => cmd.onSelect(dialog)
    }))
  })

  return (
    <DialogSelect
      title="Commands"
      placeholder="Search commands..."
      options={options()}
      flat
    />
  )
}
