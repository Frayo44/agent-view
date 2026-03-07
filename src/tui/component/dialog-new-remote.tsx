/**
 * New Remote Session dialog
 * Step-by-step flow, pre-filled with last used values
 */

import { createSignal } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import { SSHRunner } from "@/core/ssh"
import { getLastRemoteSession, saveLastRemoteSession, getRecents, loadConfig, saveConfig } from "@/core/config"
import { addRecent } from "@/core/recents"
import type { Tool, Recent } from "@/core/types"

const TOOL_OPTIONS: { title: string; value: Tool }[] = [
  { title: "Claude Code", value: "claude" },
  { title: "Shell", value: "shell" },
  { title: "OpenCode", value: "opencode" },
  { title: "Gemini CLI", value: "gemini" },
  { title: "Codex CLI", value: "codex" },
  { title: "Custom command", value: "custom" },
]

export function DialogNewRemote() {
  const dialog = useDialog()
  const toast = useToast()

  // Get last used values for defaults
  const lastSession = getLastRemoteSession()

  const [host, setHost] = createSignal(lastSession?.host || "")
  const [avPath, setAvPath] = createSignal(lastSession?.avPath || "av")
  const [selectedTool, setSelectedTool] = createSignal<Tool>((lastSession?.tool as Tool) || "claude")
  const [customCommand, setCustomCommand] = createSignal("")
  const [projectPath, setProjectPath] = createSignal(lastSession?.projectPath || "~")
  const [title, setTitle] = createSignal("")
  const [creating, setCreating] = createSignal(false)

  async function handleCreate() {
    if (creating()) return

    const hostVal = host().trim()
    const pathVal = projectPath().trim()

    if (!hostVal) {
      toast.show({ message: "Host is required", variant: "error", duration: 2000 })
      return
    }
    if (!pathVal) {
      toast.show({ message: "Project path is required", variant: "error", duration: 2000 })
      return
    }

    setCreating(true)

    try {
      const runner = new SSHRunner("remote", hostVal, avPath() || "av")
      const result = await runner.create({
        title: title().trim() || undefined,
        projectPath: pathVal,
        tool: selectedTool(),
        command: selectedTool() === "custom" ? customCommand() : undefined,
      })

      if (result.success) {
        // Save last used values
        await saveLastRemoteSession({
          host: hostVal,
          avPath: avPath() || "av",
          tool: selectedTool(),
          projectPath: pathVal,
        })

        // Save to recents
        const sessionName = title().trim() || pathVal.split("/").pop() || "remote"
        const newRecent: Recent = {
          name: sessionName,
          projectPath: pathVal,
          tool: selectedTool(),
          remoteHost: hostVal,
          remoteAvPath: avPath() || "av",
          command: selectedTool() === "custom" ? customCommand() : undefined,
        }
        const config = await loadConfig()
        const updatedRecents = addRecent(getRecents(), newRecent)
        await saveConfig({ ...config, recents: updatedRecents })

        toast.show({
          message: `Created session on ${hostVal}`,
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

  // Step 1: Enter host
  function showHostStep() {
    dialog.replace(() => (
      <InputStep
        title="New Remote Session - SSH Host"
        hint="Enter SSH host (e.g., user@hostname or ssh config name)"
        value={host()}
        placeholder="user@host"
        onSubmit={(h) => {
          if (!h.trim()) return
          setHost(h.trim())
          showAvPathStep()
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Step 2: Enter av path
  function showAvPathStep() {
    dialog.replace(() => (
      <InputStep
        title={`${host()} - av path`}
        hint="Path to av binary on remote"
        value={avPath()}
        placeholder="av"
        onSubmit={(path) => {
          setAvPath(path.trim() || "av")
          showToolStep()
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Step 3: Select tool
  function showToolStep() {
    dialog.replace(() => (
      <DialogSelect
        title={`${host()} - Select Tool`}
        options={TOOL_OPTIONS}
        current={selectedTool()}
        onSelect={(opt) => {
          setSelectedTool(opt.value)
          if (opt.value === "custom") {
            showCommandStep()
          } else {
            showPathStep()
          }
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Step 3.5: Enter custom command
  function showCommandStep() {
    dialog.replace(() => (
      <InputStep
        title={`${host()} (custom) - Command`}
        hint="Enter the command to run"
        value={customCommand()}
        placeholder="./my-script.sh"
        onSubmit={(cmd) => {
          if (!cmd.trim()) return
          setCustomCommand(cmd.trim())
          showPathStep()
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Step 4: Enter project path
  function showPathStep() {
    dialog.replace(() => (
      <InputStep
        title={`${host()} (${selectedTool()}) - Project Path`}
        hint="Enter the project path on the remote host"
        value={projectPath()}
        placeholder="/home/user/project"
        onSubmit={(path) => {
          if (!path.trim()) return
          setProjectPath(path.trim())
          showTitleStep()
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Step 5: Enter title and create
  function showTitleStep() {
    dialog.replace(() => (
      <FinalStep
        host={host()}
        tool={selectedTool()}
        path={projectPath()}
        creating={creating()}
        onSubmit={(t) => {
          setTitle(t)
          handleCreate()
        }}
      />
    ))
    dialog.setSize("large")
  }

  // Start
  showHostStep()

  return <></>
}

// Generic input step
function InputStep(props: {
  title: string
  hint: string
  value: string
  placeholder: string
  onSubmit: (value: string) => void
}) {
  const { theme } = useTheme()
  const [value, setValue] = createSignal(props.value)

  let inputRef: InputRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      props.onSubmit(value())
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={props.title} />
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.textMuted}>{props.hint}</text>
        <input
          value={value()}
          onInput={setValue}
          placeholder={props.placeholder}
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

// Final step
function FinalStep(props: {
  host: string
  tool: string
  path: string
  creating: boolean
  onSubmit: (title: string) => void
}) {
  const { theme } = useTheme()
  const [title, setTitle] = createSignal("")

  let inputRef: InputRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      props.onSubmit(title().trim())
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={`${props.host} - Create Session`} />
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
