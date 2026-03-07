/**
 * New Remote Session dialog
 * Creates a session on a remote host via SSH
 */

import { createSignal, Show } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import type { Tool } from "@/core/types"

type Step = "remote" | "tool" | "path" | "title" | "confirm"

const TOOL_OPTIONS: { title: string; value: Tool }[] = [
  { title: "Claude Code", value: "claude" },
  { title: "Shell", value: "shell" },
  { title: "OpenCode", value: "opencode" },
  { title: "Gemini CLI", value: "gemini" },
  { title: "Codex CLI", value: "codex" },
]

export function DialogNewRemote() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const remoteNames = sync.remote.getRemoteNames()

  // If no remotes configured, show message
  if (remoteNames.length === 0) {
    return (
      <box gap={1} paddingBottom={1}>
        <DialogHeader title="New Remote Session" />
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>
            No remotes configured. Press 'c' to open settings and add a remote host.
          </text>
        </box>
        <DialogFooter hint="Esc: close" />
      </box>
    )
  }

  const [step, setStep] = createSignal<Step>("remote")
  const [selectedRemote, setSelectedRemote] = createSignal("")
  const [selectedTool, setSelectedTool] = createSignal<Tool>("claude")
  const [projectPath, setProjectPath] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [creating, setCreating] = createSignal(false)

  let pathInputRef: InputRenderable | undefined
  let titleInputRef: InputRenderable | undefined

  async function handleCreate() {
    if (creating()) return

    const path = projectPath().trim()
    if (!path) {
      toast.show({ message: "Project path is required", variant: "error", duration: 2000 })
      return
    }

    setCreating(true)

    try {
      const result = await sync.remote.create(selectedRemote(), {
        title: title().trim() || undefined,
        projectPath: path,
        tool: selectedTool(),
      })

      if (result.success) {
        toast.show({
          message: `Created session on @${selectedRemote()}`,
          variant: "success",
          duration: 2000
        })
        dialog.clear()
      } else {
        toast.show({
          message: result.error || "Failed to create session",
          variant: "error",
          duration: 3000
        })
      }
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setCreating(false)
    }
  }

  // Step 1: Select remote
  function showRemoteStep() {
    const options = remoteNames.map(name => ({
      title: `@${name}`,
      value: name,
    }))

    dialog.replace(() => (
      <DialogSelect
        title="New Remote Session - Select Host"
        options={options}
        onSelect={(opt) => {
          setSelectedRemote(opt.value)
          setStep("tool")
          showToolStep()
        }}
      />
    ))
  }

  // Step 2: Select tool
  function showToolStep() {
    dialog.replace(() => (
      <DialogSelect
        title={`@${selectedRemote()} - Select Tool`}
        options={TOOL_OPTIONS}
        onSelect={(opt) => {
          setSelectedTool(opt.value)
          setStep("path")
          showPathStep()
        }}
      />
    ))
  }

  // Step 3: Enter path
  function showPathStep() {
    dialog.replace(() => (
      <PathStep
        remote={selectedRemote()}
        tool={selectedTool()}
        value={projectPath()}
        onSubmit={(path) => {
          setProjectPath(path)
          setStep("title")
          showTitleStep()
        }}
      />
    ))
  }

  // Step 4: Enter title (optional)
  function showTitleStep() {
    dialog.replace(() => (
      <TitleStep
        remote={selectedRemote()}
        tool={selectedTool()}
        path={projectPath()}
        value={title()}
        onSubmit={(t) => {
          setTitle(t)
          handleCreate()
        }}
        onSkip={() => {
          handleCreate()
        }}
        creating={creating()}
      />
    ))
  }

  // Start with remote selection
  showRemoteStep()

  return <></>
}

// Path input step component
function PathStep(props: {
  remote: string
  tool: string
  value: string
  onSubmit: (path: string) => void
}) {
  const { theme } = useTheme()
  const [path, setPath] = createSignal(props.value || "~")

  let inputRef: InputRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      const p = path().trim()
      if (p) {
        props.onSubmit(p)
      }
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={`@${props.remote} (${props.tool}) - Project Path`} />

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.textMuted}>Enter the project path on the remote host:</text>
        <input
          value={path()}
          onInput={setPath}
          placeholder="/home/user/project"
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      <DialogFooter hint="Enter: continue | Esc: cancel" />
    </box>
  )
}

// Title input step component
function TitleStep(props: {
  remote: string
  tool: string
  path: string
  value: string
  onSubmit: (title: string) => void
  onSkip: () => void
  creating: boolean
}) {
  const { theme } = useTheme()
  const [title, setTitle] = createSignal(props.value)

  let inputRef: InputRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      props.onSubmit(title().trim())
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={`@${props.remote} - Session Title`} />

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.textMuted}>Tool: {props.tool}</text>
        <text fg={theme.textMuted}>Path: {props.path}</text>
        <box height={1} />
        <text fg={theme.primary}>Title (optional):</text>
        <input
          value={title()}
          onInput={setTitle}
          placeholder="auto-generated if empty"
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      <ActionButton
        label="Create Session"
        loadingLabel="Creating..."
        loading={props.creating}
        onAction={() => props.onSubmit(title().trim())}
      />

      <DialogFooter hint="Enter: create | Esc: cancel" />
    </box>
  )
}
