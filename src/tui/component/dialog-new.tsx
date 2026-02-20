/**
 * New session dialog with Tab navigation and worktree support
 */

import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useConfig } from "@tui/context/config"
import { useDialog, scrollDialogBy, scrollDialogTo } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { InputAutocomplete } from "@tui/ui/input-autocomplete"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import { attachSessionSync } from "@/core/tmux"
import { isGitRepo, getRepoRoot, createWorktree, generateBranchName, generateWorktreePath, sanitizeBranchName, branchExists } from "@/core/git"
import { HistoryManager } from "@/core/history"
import { getStorage } from "@/core/storage"
import type { Tool, ClaudeSessionMode } from "@/core/types"
import { getToolCommand } from "@/core/types"
import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"

const execAsync = promisify(exec)

async function commandExists(cmd: string, cwd?: string): Promise<boolean> {
  // For relative paths (./something), check if file exists in cwd
  if (cmd.startsWith("./") || cmd.startsWith("../")) {
    if (!cwd) return false
    const fullPath = path.join(cwd, cmd)
    return existsSync(fullPath)
  }
  // For absolute paths, check if file exists
  if (cmd.startsWith("/")) {
    return existsSync(cmd)
  }
  // For commands in PATH, use which
  try {
    await execAsync(`which ${cmd}`)
    return true
  } catch {
    return false
  }
}

// History managers for autocomplete suggestions
const projectPathHistory = new HistoryManager("dialog-new:project-paths", 30)
const branchNameHistory = new HistoryManager("dialog-new:branch-names", 30)

const TOOLS: { value: Tool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's Claude CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
  { value: "gemini", label: "Gemini", description: "Google's Gemini CLI" },
  { value: "codex", label: "Codex", description: "OpenAI's Codex CLI" },
  { value: "custom", label: "Custom", description: "Custom command" },
  { value: "shell", label: "Shell", description: "Plain terminal session" }
]

type FocusField = "title" | "tool" | "resumeSession" | "skipPermissions" | "customCommand" | "path" | "worktree" | "branch"

export function DialogNew() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const { config } = useConfig()

  const defaultTool = config().defaultTool || "claude"
  const defaultToolIndex = TOOLS.findIndex(t => t.value === defaultTool)

  const [title, setTitle] = createSignal("")
  const [selectedTool, setSelectedTool] = createSignal<Tool>(defaultTool)
  const [customCommand, setCustomCommand] = createSignal("")
  const [projectPath, setProjectPath] = createSignal(process.cwd())
  const [creating, setCreating] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal("")
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const [errorMessage, setErrorMessage] = createSignal("")

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  createEffect(() => {
    if (creating()) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % spinnerFrames.length)
      }, 80)
      onCleanup(() => clearInterval(interval))
    }
  })

  const [claudeSessionMode, setClaudeSessionMode] = createSignal<ClaudeSessionMode>("new")
  const [skipPermissions, setSkipPermissions] = createSignal(false)

  const [useWorktree, setUseWorktree] = createSignal(false)
  const [worktreeBranch, setWorktreeBranch] = createSignal("")
  const [isInGitRepo, setIsInGitRepo] = createSignal(false)
  const [useBaseDevelop, setUseBaseDevelop] = createSignal(false)
  const [developExists, setDevelopExists] = createSignal(false)

  const storage = getStorage()

  const [focusedField, setFocusedField] = createSignal<FocusField>("title")
  const [toolIndex, setToolIndex] = createSignal(defaultToolIndex >= 0 ? defaultToolIndex : 0)

  let titleInputRef: InputRenderable | undefined
  let customCommandInputRef: InputRenderable | undefined
  let pathInputRef: InputRenderable | undefined
  let branchInputRef: InputRenderable | undefined

  createEffect(() => {
    if (selectedTool() !== "claude") {
      setClaudeSessionMode("new")
    }
  })

  createEffect(async () => {
    const path = projectPath()
    try {
      const result = await isGitRepo(path)
      setIsInGitRepo(result)
      if (!result) {
        setUseWorktree(false)
        setDevelopExists(false)
        setUseBaseDevelop(false)
      } else {
        const repoRoot = await getRepoRoot(path)
        const hasDevelop = await branchExists(repoRoot, "develop")
        setDevelopExists(hasDevelop)
        if (!hasDevelop) {
          setUseBaseDevelop(false)
        }
      }
    } catch {
      setIsInGitRepo(false)
      setUseWorktree(false)
      setDevelopExists(false)
      setUseBaseDevelop(false)
    }
  })

  createEffect(() => {
    const field = focusedField()

    if (field === "title") {
      titleInputRef?.focus()
    } else {
      titleInputRef?.blur()
    }

    if (field === "customCommand") {
      customCommandInputRef?.focus()
    } else {
      customCommandInputRef?.blur()
    }

    if (field === "path") {
      pathInputRef?.focus()
    } else {
      pathInputRef?.blur()
    }

    if (field === "branch") {
      branchInputRef?.focus()
    } else {
      branchInputRef?.blur()
    }
  })

  function getFocusableFields(): FocusField[] {
    const fields: FocusField[] = ["title", "tool"]
    if (selectedTool() === "claude") {
      fields.push("resumeSession")
      fields.push("skipPermissions")
    }
    if (selectedTool() === "custom") {
      fields.push("customCommand")
    }
    fields.push("path")
    if (isInGitRepo()) {
      fields.push("worktree")
      if (useWorktree()) {
        fields.push("branch")
      }
    }
    return fields
  }

  async function handleCreate() {
    if (creating()) return
    setCreating(true)
    setStatusMessage("Preparing...")
    setErrorMessage("")

    try {
      if (selectedTool() === "custom" && !customCommand().trim()) {
        throw new Error("Please enter a custom command")
      }

      let sessionProjectPath = projectPath().trim() || process.cwd()
      // Expand ~ to home directory (shell doesn't do this for us)
      if (sessionProjectPath.startsWith("~")) {
        sessionProjectPath = sessionProjectPath.replace("~", process.env.HOME || "")
      }
      if (!existsSync(sessionProjectPath)) {
        throw new Error(`Directory '${sessionProjectPath}' does not exist`)
      }

      const toolCmd = getToolCommand(selectedTool(), customCommand())
      const cmdToCheck = toolCmd.split(" ")[0] || toolCmd
      setStatusMessage(`Checking ${cmdToCheck}...`)
      const exists = await commandExists(cmdToCheck, sessionProjectPath)
      if (!exists) {
        throw new Error(`Command '${cmdToCheck}' not found.`)
      }

      let worktreePath: string | undefined
      let worktreeRepo: string | undefined
      let worktreeBranchName: string | undefined

      if (useWorktree() && isInGitRepo()) {
        setStatusMessage("Creating worktree...")
        const repoRoot = await getRepoRoot(projectPath())
        const branchName = worktreeBranch()
          ? sanitizeBranchName(worktreeBranch())
          : generateBranchName(title() || undefined)

        const worktreeConfig = config().worktree || {}

        // Priority: 1) "Base on develop" checkbox, 2) config default, 3) undefined (HEAD)
        let baseBranch: string | undefined
        if (useBaseDevelop()) {
          baseBranch = "develop"
        } else if (worktreeConfig.defaultBaseBranch && worktreeConfig.defaultBaseBranch !== "main") {
          baseBranch = worktreeConfig.defaultBaseBranch
        }

        const wtPath = generateWorktreePath(repoRoot, branchName)

        worktreePath = await createWorktree(repoRoot, branchName, wtPath, baseBranch)
        sessionProjectPath = worktreePath
        worktreeRepo = repoRoot
        worktreeBranchName = branchName
      }

      setStatusMessage("Starting session...")

      const claudeOptions = selectedTool() === "claude" ? {
        sessionMode: claudeSessionMode(),
        skipPermissions: skipPermissions()
      } : undefined

      const session = await sync.session.create({
        title: title() || undefined,
        tool: selectedTool(),
        command: selectedTool() === "custom" ? customCommand() : undefined,
        projectPath: sessionProjectPath,
        worktreePath,
        worktreeRepo,
        worktreeBranch: worktreeBranchName,
        claudeOptions
      })

      projectPathHistory.addEntry(storage, projectPath())
      if (useWorktree() && worktreeBranchName) {
        branchNameHistory.addEntry(storage, worktreeBranchName)
      }

      const message = useWorktree()
        ? `Created ${session.title} in worktree`
        : `Created ${session.title}`
      toast.show({ message, variant: "success", duration: 2000 })

      if (session.tmuxSession) {
        renderer.suspend()
        attachSessionSync(session.tmuxSession)
        renderer.resume()
      }

      dialog.clear()
      sync.refresh()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setErrorMessage(errorMsg)
      toast.error(err as Error)
    } finally {
      setCreating(false)
      setStatusMessage("")
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleCreate()
      return
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const fields = getFocusableFields()
      if (fields.length === 0) return
      const currentIdx = fields.indexOf(focusedField())
      if (currentIdx === -1) {
        const first = fields[0]
        if (first) setFocusedField(first)
      } else {
        const nextIdx = evt.shift
          ? (currentIdx - 1 + fields.length) % fields.length
          : (currentIdx + 1) % fields.length
        const nextField = fields[nextIdx]
        if (nextField) {
          setFocusedField(nextField)
          // Auto-scroll: detect wrap-around
          const wrappedToStart = !evt.shift && nextIdx === 0 && currentIdx === fields.length - 1
          const wrappedToEnd = evt.shift && nextIdx === fields.length - 1 && currentIdx === 0
          if (wrappedToStart) {
            scrollDialogTo(0) // Scroll to top
          } else if (wrappedToEnd) {
            scrollDialogTo(9999) // Scroll to bottom
          } else {
            scrollDialogBy(evt.shift ? -3 : 3)
          }
        }
      }
      return
    }

    if (focusedField() === "tool") {
      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        const newIdx = (toolIndex() - 1 + TOOLS.length) % TOOLS.length
        setToolIndex(newIdx)
        const tool = TOOLS[newIdx]
        if (tool) {
          setSelectedTool(tool.value)
          setErrorMessage("") // Clear error on tool change
        }
        return
      }
      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        const newIdx = (toolIndex() + 1) % TOOLS.length
        setToolIndex(newIdx)
        const tool = TOOLS[newIdx]
        if (tool) {
          setSelectedTool(tool.value)
          setErrorMessage("") // Clear error on tool change
        }
        return
      }
    }

    if (focusedField() === "worktree" && evt.name === "space") {
      evt.preventDefault()
      setUseWorktree(!useWorktree())
      return
    }

    if (focusedField() === "resumeSession" && evt.name === "space") {
      evt.preventDefault()
      setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")
      return
    }

    if (focusedField() === "skipPermissions" && evt.name === "space") {
      evt.preventDefault()
      setSkipPermissions(!skipPermissions())
      return
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="New Session" />

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={focusedField() === "title" ? theme.primary : theme.textMuted}>
          Title (optional)
        </text>
        <box onMouseUp={() => setFocusedField("title")}>
          <input
            placeholder="auto-generated if empty"
            value={title()}
            onInput={setTitle}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              titleInputRef = r
              setTimeout(() => {
                if (focusedField() === "title") {
                  titleInputRef?.focus()
                }
              }, 1)
            }}
          />
        </box>
      </box>

      {/* Tool selection */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "tool" ? theme.primary : theme.textMuted}>
          Tool
        </text>
        <box gap={0} flexDirection="column">
          <For each={TOOLS}>
            {(tool, idx) => (
              <box
                flexDirection="row"
                gap={1}
                height={1}
                onMouseUp={() => {
                  setSelectedTool(tool.value)
                  setToolIndex(idx())
                  setFocusedField("tool")
                  setErrorMessage("") // Clear error on tool change
                }}
                paddingLeft={1}
                backgroundColor={
                  selectedTool() === tool.value
                    ? theme.backgroundElement
                    : undefined
                }
              >
                <text fg={selectedTool() === tool.value ? theme.primary : theme.textMuted}>
                  {selectedTool() === tool.value ? "●" : "○"}
                </text>
                <text fg={theme.text}>{tool.label}</text>
                <text fg={theme.textMuted}>- {tool.description}</text>
              </box>
            )}
          </For>
        </box>

      </box>

      {/* Claude options checkboxes (only when Claude is selected) */}
      <Show when={selectedTool() === "claude"}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={3}>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setFocusedField("resumeSession")
              setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")
            }}
          >
            <text fg={focusedField() === "resumeSession" ? theme.primary : theme.textMuted}>
              {claudeSessionMode() === "resume" ? "[x]" : "[ ]"}
            </text>
            <text fg={focusedField() === "resumeSession" ? theme.text : theme.textMuted}>
              Resume
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setFocusedField("skipPermissions")
              setSkipPermissions(!skipPermissions())
            }}
          >
            <text fg={focusedField() === "skipPermissions" ? theme.primary : theme.textMuted}>
              {skipPermissions() ? "[x]" : "[ ]"}
            </text>
            <text fg={focusedField() === "skipPermissions" ? theme.text : theme.textMuted}>
              Skip Permissions
            </text>
          </box>
        </box>
      </Show>

      {/* Custom command input (only when custom tool is selected) */}
      <Show when={selectedTool() === "custom"}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
          <text fg={focusedField() === "customCommand" ? theme.primary : theme.textMuted}>
            Custom Command
          </text>
          <box onMouseUp={() => setFocusedField("customCommand")}>
            <input
              placeholder="e.g., aider, cursor, vim"
              value={customCommand()}
              onInput={setCustomCommand}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              ref={(r) => {
                customCommandInputRef = r
              }}
            />
          </box>
        </box>
      </Show>

      {/* Path field with autocomplete */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "path" ? theme.primary : theme.textMuted}>
          Project Path
        </text>
        <InputAutocomplete
          value={projectPath()}
          onInput={setProjectPath}
          suggestions={projectPathHistory.getFiltered(storage, projectPath())}
          onSelect={setProjectPath}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          onFocus={() => setFocusedField("path")}
          ref={(r) => {
            pathInputRef = r
          }}
        />
      </box>

      {/* Worktree option (only shown in git repos) */}
      <Show when={isInGitRepo()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setFocusedField("worktree")
              setUseWorktree(!useWorktree())
            }}
          >
            <text fg={focusedField() === "worktree" ? theme.primary : theme.textMuted}>
              {useWorktree() ? "[x]" : "[ ]"}
            </text>
            <text fg={focusedField() === "worktree" ? theme.text : theme.textMuted}>
              Create in git worktree
            </text>
          </box>

          {/* Branch name input with autocomplete (only when worktree is enabled) */}
          <Show when={useWorktree()}>
            <box paddingLeft={4} gap={1}>
              <text fg={focusedField() === "branch" ? theme.primary : theme.textMuted}>
                Branch name
              </text>
              <InputAutocomplete
                placeholder="auto-generated from title if empty"
                value={worktreeBranch()}
                onInput={setWorktreeBranch}
                suggestions={branchNameHistory.getFiltered(storage, worktreeBranch())}
                onSelect={setWorktreeBranch}
                focusedBackgroundColor={theme.backgroundElement}
                cursorColor={theme.primary}
                focusedTextColor={theme.text}
                onFocus={() => setFocusedField("branch")}
                ref={(r) => {
                  branchInputRef = r
                }}
              />
            </box>

            {/* Base on develop toggle */}
            <Show when={developExists()}>
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={4}
                onMouseUp={(e) => {
                  e.stopPropagation()
                  setUseBaseDevelop(!useBaseDevelop())
                }}
              >
                <text fg={useBaseDevelop() ? theme.primary : theme.textMuted}>
                  {useBaseDevelop() ? "[x]" : "[ ]"}
                </text>
                <text fg={theme.textMuted}>Base on develop</text>
              </box>
            </Show>
          </Show>
        </box>
      </Show>

      {/* Error display */}
      <Show when={errorMessage()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <box
            backgroundColor={theme.error}
            padding={1}
            onMouseUp={() => setErrorMessage("")}
          >
            <text fg={theme.selectedListItemText} wrapMode="word">
              {errorMessage()}
            </text>
          </box>
        </box>
      </Show>

      <ActionButton
        label="Create Session"
        loadingLabel={`${spinnerFrames[spinnerFrame()]} ${statusMessage()}`}
        loading={creating()}
        onAction={handleCreate}
      />

      <DialogFooter hint={creating() ? statusMessage() : "Tab | Enter: create"} />
    </box>
  )
}
