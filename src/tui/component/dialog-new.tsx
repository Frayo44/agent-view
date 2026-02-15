/**
 * New session dialog with Tab navigation and worktree support
 */

import { createSignal, createEffect, For, Show } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { attachSessionSync } from "@/core/tmux"
import { isGitRepo, getRepoRoot, createWorktree, generateBranchName, sanitizeBranchName } from "@/core/git"
import type { Tool } from "@/core/types"

const TOOLS: { value: Tool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's Claude CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
  { value: "gemini", label: "Gemini", description: "Google's Gemini CLI" },
  { value: "shell", label: "Shell", description: "Plain terminal session" }
]

type FocusField = "title" | "tool" | "path" | "worktree" | "branch"

export function DialogNew() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()

  // Form state
  const [title, setTitle] = createSignal("")
  const [selectedTool, setSelectedTool] = createSignal<Tool>("claude")
  const [projectPath, setProjectPath] = createSignal(process.cwd())
  const [creating, setCreating] = createSignal(false)

  // Worktree state
  const [useWorktree, setUseWorktree] = createSignal(false)
  const [worktreeBranch, setWorktreeBranch] = createSignal("")
  const [isInGitRepo, setIsInGitRepo] = createSignal(false)

  // Focus state for Tab navigation
  const [focusedField, setFocusedField] = createSignal<FocusField>("title")
  const [toolIndex, setToolIndex] = createSignal(0)

  // Input refs
  let titleInputRef: InputRenderable | undefined
  let pathInputRef: InputRenderable | undefined
  let branchInputRef: InputRenderable | undefined

  // Check if current path is a git repo
  createEffect(async () => {
    const path = projectPath()
    try {
      const result = await isGitRepo(path)
      setIsInGitRepo(result)
      // Reset worktree option if not in git repo
      if (!result) {
        setUseWorktree(false)
      }
    } catch {
      setIsInGitRepo(false)
      setUseWorktree(false)
    }
  })

  // Focus management - blur/focus inputs based on focusedField
  createEffect(() => {
    const field = focusedField()

    // Handle title input
    if (field === "title") {
      titleInputRef?.focus()
    } else {
      titleInputRef?.blur()
    }

    // Handle path input
    if (field === "path") {
      pathInputRef?.focus()
    } else {
      pathInputRef?.blur()
    }

    // Handle branch input
    if (field === "branch") {
      branchInputRef?.focus()
    } else {
      branchInputRef?.blur()
    }
  })

  // Get the list of focusable fields based on current state
  function getFocusableFields(): FocusField[] {
    const fields: FocusField[] = ["title", "tool", "path"]
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

    try {
      let sessionProjectPath = projectPath()
      let worktreePath: string | undefined
      let worktreeRepo: string | undefined
      let worktreeBranchName: string | undefined

      // Handle worktree creation
      if (useWorktree() && isInGitRepo()) {
        const repoRoot = await getRepoRoot(projectPath())
        const branchName = worktreeBranch()
          ? sanitizeBranchName(worktreeBranch())
          : generateBranchName(title() || undefined)

        worktreePath = await createWorktree(repoRoot, branchName)
        sessionProjectPath = worktreePath
        worktreeRepo = repoRoot
        worktreeBranchName = branchName
      }

      const session = await sync.session.create({
        title: title() || undefined,
        tool: selectedTool(),
        projectPath: sessionProjectPath,
        worktreePath,
        worktreeRepo,
        worktreeBranch: worktreeBranchName
      })

      const message = useWorktree()
        ? `Created ${session.title} in worktree`
        : `Created ${session.title}`
      toast.show({ message, variant: "success", duration: 2000 })

      // Auto-attach to the new session
      if (session.tmuxSession) {
        // Suspend TUI and attach
        renderer.suspend()
        attachSessionSync(session.tmuxSession)
        renderer.resume()
      }

      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setCreating(false)
    }
  }

  useKeyboard((evt) => {
    // Enter to create (when not in multi-line context)
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleCreate()
      return
    }

    // Tab navigation
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
        if (nextField) setFocusedField(nextField)
      }
      return
    }

    // Arrow key navigation for tool selection
    if (focusedField() === "tool") {
      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        const newIdx = (toolIndex() - 1 + TOOLS.length) % TOOLS.length
        setToolIndex(newIdx)
        const tool = TOOLS[newIdx]
        if (tool) setSelectedTool(tool.value)
        return
      }
      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        const newIdx = (toolIndex() + 1) % TOOLS.length
        setToolIndex(newIdx)
        const tool = TOOLS[newIdx]
        if (tool) setSelectedTool(tool.value)
        return
      }
    }

    // Space to toggle worktree checkbox
    if (focusedField() === "worktree" && evt.name === "space") {
      evt.preventDefault()
      setUseWorktree(!useWorktree())
      return
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            New Session
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
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
              // Initial focus
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
        <box gap={0}>
          <For each={TOOLS}>
            {(tool, idx) => (
              <box
                flexDirection="row"
                gap={1}
                onMouseUp={() => {
                  setSelectedTool(tool.value)
                  setToolIndex(idx())
                  setFocusedField("tool")
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

      {/* Path field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "path" ? theme.primary : theme.textMuted}>
          Project Path
        </text>
        <box onMouseUp={() => setFocusedField("path")}>
          <input
            value={projectPath()}
            onInput={setProjectPath}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              pathInputRef = r
            }}
          />
        </box>
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

          {/* Branch name input (only when worktree is enabled) */}
          <Show when={useWorktree()}>
            <box paddingLeft={4} gap={1}>
              <text fg={focusedField() === "branch" ? theme.primary : theme.textMuted}>
                Branch name
              </text>
              <box onMouseUp={() => setFocusedField("branch")}>
                <input
                  placeholder="auto-generated from title if empty"
                  value={worktreeBranch()}
                  onInput={setWorktreeBranch}
                  focusedBackgroundColor={theme.backgroundElement}
                  cursorColor={theme.primary}
                  focusedTextColor={theme.text}
                  ref={(r) => {
                    branchInputRef = r
                  }}
                />
              </box>
            </box>
          </Show>
        </box>
      </Show>

      {/* Create button */}
      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={creating() ? theme.backgroundElement : theme.primary}
          padding={1}
          onMouseUp={handleCreate}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {creating() ? "Creating..." : "Create Session"}
          </text>
        </box>
      </box>

      {/* Footer with keybind hints */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          Tab: next field | Shift+Tab: prev | Enter: create
        </text>
      </box>
    </box>
  )
}
