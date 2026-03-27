/**
 * Multi-step wizard for creating new sessions
 * Triggered by Shift+N
 */

import { createSignal, createEffect, For, Show, onCleanup, createMemo, Switch, Match } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
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
  if (cmd.startsWith("./") || cmd.startsWith("../")) {
    if (!cwd) return false
    const fullPath = path.join(cwd, cmd)
    return existsSync(fullPath)
  }
  if (cmd.startsWith("/")) {
    return existsSync(cmd)
  }
  try {
    await execAsync(`which ${cmd}`)
    return true
  } catch {
    return false
  }
}

const projectPathHistory = new HistoryManager("dialog-new:project-paths", 15)
const branchNameHistory = new HistoryManager("dialog-new:branch-names", 15)

const TOOLS: { value: Tool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's Claude CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
  { value: "gemini", label: "Gemini", description: "Google's Gemini CLI" },
  { value: "codex", label: "Codex", description: "OpenAI's Codex CLI" },
  { value: "custom", label: "Custom", description: "Custom command" },
  { value: "shell", label: "Shell", description: "Plain terminal session" }
]

type WizardStep = "tool" | "path" | "options" | "confirm"

const STEP_ORDER: WizardStep[] = ["tool", "path", "options", "confirm"]

function getStepTitle(step: WizardStep): string {
  switch (step) {
    case "tool": return "Select Tool"
    case "path": return "Project Path"
    case "options": return "Options"
    case "confirm": return "Confirm"
  }
}

function getStepNumber(step: WizardStep): number {
  return STEP_ORDER.indexOf(step) + 1
}

export function DialogNewWizard() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const { config } = useConfig()

  const defaultTool = config().defaultTool || "claude"
  const defaultToolIndex = TOOLS.findIndex(t => t.value === defaultTool)

  // Wizard state
  const [currentStep, setCurrentStep] = createSignal<WizardStep>("tool")

  // Form data
  const [title, setTitle] = createSignal("")
  const [selectedTool, setSelectedTool] = createSignal<Tool>(defaultTool)
  const [customCommand, setCustomCommand] = createSignal("")
  const [projectPath, setProjectPath] = createSignal(process.cwd())
  const [claudeSessionMode, setClaudeSessionMode] = createSignal<ClaudeSessionMode>("new")
  const [skipPermissions, setSkipPermissions] = createSignal(false)
  const [useWorktree, setUseWorktree] = createSignal(false)
  const [worktreeBranch, setWorktreeBranch] = createSignal("")
  const [useBaseDevelop, setUseBaseDevelop] = createSignal(false)

  // UI state
  const [creating, setCreating] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal("")
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const [errorMessage, setErrorMessage] = createSignal("")
  const [toolIndex, setToolIndex] = createSignal(defaultToolIndex >= 0 ? defaultToolIndex : 0)
  const [isInGitRepo, setIsInGitRepo] = createSignal(false)
  const [developExists, setDevelopExists] = createSignal(false)

  // Path step focus field
  type PathFocusField = "path" | "worktree" | "branch" | "baseDevelop"
  const [pathFocusField, setPathFocusField] = createSignal<PathFocusField>("path")

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const storage = getStorage()

  let titleInputRef: InputRenderable | undefined
  let customCommandInputRef: InputRenderable | undefined
  let pathInputRef: InputRenderable | undefined
  let branchInputRef: InputRenderable | undefined

  // Spinner animation
  createEffect(() => {
    if (creating()) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % spinnerFrames.length)
      }, 80)
      onCleanup(() => clearInterval(interval))
    }
  })

  // Reset claude options when tool changes
  createEffect(() => {
    if (selectedTool() !== "claude") {
      setClaudeSessionMode("new")
      setSkipPermissions(false)
    }
  })

  // Check git repo status when path changes
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

  // Focus management
  createEffect(() => {
    const step = currentStep()

    setTimeout(() => {
      if (step === "path") {
        setPathFocusField("path")
        pathInputRef?.focus()
      } else if (step === "options") {
        if (selectedTool() === "custom") {
          customCommandInputRef?.focus()
        } else {
          titleInputRef?.focus()
        }
      }
    }, 50)
  })

  // Path step focus management
  createEffect(() => {
    if (currentStep() !== "path") return

    const field = pathFocusField()
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

  function getPathFocusableFields(): PathFocusField[] {
    const fields: PathFocusField[] = ["path"]
    if (isInGitRepo()) {
      fields.push("worktree")
      if (useWorktree()) {
        fields.push("branch")
        if (developExists()) {
          fields.push("baseDevelop")
        }
      }
    }
    return fields
  }

  function goToNextStep() {
    const idx = STEP_ORDER.indexOf(currentStep())
    if (idx < STEP_ORDER.length - 1) {
      // Auto-populate title with folder name when moving from path to options
      if (currentStep() === "path" && !title()) {
        const p = projectPath().trim()
        const expanded = p.startsWith("~") ? p.replace("~", process.env.HOME || "") : p
        const folderName = path.basename(expanded)
        if (folderName) {
          setTitle(folderName)
        }
      }
      setCurrentStep(STEP_ORDER[idx + 1]!)
      setErrorMessage("")
    }
  }

  function goToPrevStep() {
    const idx = STEP_ORDER.indexOf(currentStep())
    if (idx > 0) {
      setCurrentStep(STEP_ORDER[idx - 1]!)
      setErrorMessage("")
    } else {
      dialog.clear()
    }
  }

  function canProceed(): boolean {
    const step = currentStep()

    if (step === "tool") {
      return true
    }

    if (step === "path") {
      const p = projectPath().trim()
      if (!p) return false
      const expanded = p.startsWith("~") ? p.replace("~", process.env.HOME || "") : p
      return existsSync(expanded)
    }

    if (step === "options") {
      if (selectedTool() === "custom" && !customCommand().trim()) {
        return false
      }
      return true
    }

    return true
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
    if (creating()) return

    // Escape: go back to previous step
    if (evt.name === "escape") {
      evt.preventDefault()
      goToPrevStep()
      return
    }

    // Enter: proceed to next step or create
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      if (currentStep() === "confirm") {
        handleCreate()
      } else if (canProceed()) {
        goToNextStep()
      }
      return
    }

    // Tool selection step navigation
    if (currentStep() === "tool") {
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

    // Path step: Tab navigation and worktree toggle
    if (currentStep() === "path") {
      if (evt.name === "tab") {
        evt.preventDefault()
        const fields = getPathFocusableFields()
        const currentIdx = fields.indexOf(pathFocusField())
        if (currentIdx === -1) {
          setPathFocusField(fields[0] || "path")
        } else {
          const nextIdx = evt.shift
            ? (currentIdx - 1 + fields.length) % fields.length
            : (currentIdx + 1) % fields.length
          setPathFocusField(fields[nextIdx] || "path")
        }
        return
      }
      // Space to toggle when focused on worktree or baseDevelop
      if (evt.name === "space") {
        if (pathFocusField() === "worktree") {
          evt.preventDefault()
          setUseWorktree(!useWorktree())
          return
        }
        if (pathFocusField() === "baseDevelop") {
          evt.preventDefault()
          setUseBaseDevelop(!useBaseDevelop())
          return
        }
      }
      if (evt.ctrl && evt.name === "w") {
        evt.preventDefault()
        if (isInGitRepo()) {
          setUseWorktree(!useWorktree())
        }
        return
      }
    }

    // Options step: toggle checkboxes
    if (currentStep() === "options" && selectedTool() === "claude") {
      if (evt.ctrl && evt.name === "r") {
        evt.preventDefault()
        setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")
        return
      }
      if (evt.ctrl && evt.name === "p") {
        evt.preventDefault()
        setSkipPermissions(!skipPermissions())
        return
      }
    }
  })

  const toolLabel = createMemo(() => {
    const tool = TOOLS.find(t => t.value === selectedTool())
    return tool?.label || selectedTool()
  })

  // Step indicator component
  function StepIndicator() {
    return (
      <box flexDirection="row" justifyContent="center" gap={1} paddingBottom={1}>
        <For each={STEP_ORDER}>
          {(step, idx) => {
            const isActive = () => currentStep() === step
            const isPast = () => STEP_ORDER.indexOf(currentStep()) > idx()
            return (
              <>
                <Show when={idx() > 0}>
                  <text fg={isPast() ? theme.primary : theme.textMuted}>─</text>
                </Show>
                <box flexDirection="row" gap={1}>
                  <text
                    fg={isActive() ? theme.primary : isPast() ? theme.success : theme.textMuted}
                    attributes={isActive() ? TextAttributes.BOLD : undefined}
                  >
                    {isPast() ? "✓" : (idx() + 1).toString()}
                  </text>
                  <text
                    fg={isActive() ? theme.text : theme.textMuted}
                    attributes={isActive() ? TextAttributes.BOLD : undefined}
                  >
                    {getStepTitle(step)}
                  </text>
                </box>
              </>
            )
          }}
        </For>
      </box>
    )
  }

  // Step 1: Tool selection
  function ToolStep() {
    return (
      <box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
        <text fg={theme.textMuted}>Select the tool to use for this session:</text>
        <box gap={0} flexDirection="column" paddingTop={1}>
          <For each={TOOLS}>
            {(tool, idx) => (
              <box
                flexDirection="row"
                gap={1}
                height={1}
                onMouseUp={() => {
                  setSelectedTool(tool.value)
                  setToolIndex(idx())
                }}
                paddingLeft={1}
                backgroundColor={selectedTool() === tool.value ? theme.backgroundElement : undefined}
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
    )
  }

  // Step 2: Path configuration
  function PathStep() {
    return (
      <box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
        <text fg={pathFocusField() === "path" ? theme.primary : theme.textMuted}>
          Enter the project path:
        </text>
        <box onMouseUp={() => setPathFocusField("path")}>
          <InputAutocomplete
            value={projectPath()}
            onInput={setProjectPath}
            suggestions={projectPathHistory.getFiltered(storage, projectPath())}
            onSelect={setProjectPath}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            onFocus={() => setPathFocusField("path")}
            ref={(r) => { pathInputRef = r }}
          />
        </box>

        <Show when={!existsSync(projectPath().startsWith("~") ? projectPath().replace("~", process.env.HOME || "") : projectPath())}>
          <text fg={theme.error}>Directory does not exist</text>
        </Show>

        <Show when={isInGitRepo()}>
          <box paddingTop={1} gap={1} flexDirection="column">
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={pathFocusField() === "worktree" ? theme.backgroundElement : undefined}
              onMouseUp={() => {
                setPathFocusField("worktree")
                setUseWorktree(!useWorktree())
              }}
            >
              <text fg={pathFocusField() === "worktree" ? theme.primary : (useWorktree() ? theme.primary : theme.textMuted)}>
                {useWorktree() ? "[x]" : "[ ]"}
              </text>
              <text fg={pathFocusField() === "worktree" ? theme.text : theme.text}>
                Create in git worktree
              </text>
              <text fg={theme.textMuted}>(Tab/Space)</text>
            </box>

            <Show when={useWorktree()}>
              <box paddingLeft={4} gap={1} flexDirection="column">
                <text fg={pathFocusField() === "branch" ? theme.primary : theme.textMuted}>
                  Branch name (optional):
                </text>
                <box onMouseUp={() => setPathFocusField("branch")}>
                  <InputAutocomplete
                    placeholder="auto-generated from title if empty"
                    value={worktreeBranch()}
                    onInput={setWorktreeBranch}
                    suggestions={branchNameHistory.getFiltered(storage, worktreeBranch())}
                    onSelect={setWorktreeBranch}
                    onFocus={() => setPathFocusField("branch")}
                    focusedBackgroundColor={theme.backgroundElement}
                    cursorColor={theme.primary}
                    focusedTextColor={theme.text}
                    ref={(r) => { branchInputRef = r }}
                  />
                </box>

                <Show when={developExists()}>
                  <box
                    flexDirection="row"
                    gap={1}
                    backgroundColor={pathFocusField() === "baseDevelop" ? theme.backgroundElement : undefined}
                    onMouseUp={() => {
                      setPathFocusField("baseDevelop")
                      setUseBaseDevelop(!useBaseDevelop())
                    }}
                  >
                    <text fg={pathFocusField() === "baseDevelop" ? theme.primary : (useBaseDevelop() ? theme.primary : theme.textMuted)}>
                      {useBaseDevelop() ? "[x]" : "[ ]"}
                    </text>
                    <text fg={pathFocusField() === "baseDevelop" ? theme.text : theme.textMuted}>
                      Base on develop
                    </text>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>
      </box>
    )
  }

  // Step 3: Options (title + tool-specific)
  function OptionsStep() {
    return (
      <box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
        <Show when={selectedTool() === "custom"}>
          <box gap={1} flexDirection="column">
            <text fg={theme.textMuted}>Custom command:</text>
            <input
              placeholder="e.g., aider, cursor, vim"
              value={customCommand()}
              onInput={setCustomCommand}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              ref={(r) => { customCommandInputRef = r }}
            />
          </box>
          <box height={1} />
        </Show>

        <text fg={theme.textMuted}>Session title (optional):</text>
        <input
          placeholder="auto-generated if empty"
          value={title()}
          onInput={setTitle}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => { titleInputRef = r }}
        />

        <Show when={selectedTool() === "claude"}>
          <box paddingTop={1} gap={1} flexDirection="column">
            <text fg={theme.textMuted}>Claude options:</text>
            <box flexDirection="row" gap={3} paddingLeft={2}>
              <box
                flexDirection="row"
                gap={1}
                onMouseUp={() => setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")}
              >
                <text fg={theme.primary}>
                  {claudeSessionMode() === "resume" ? "[x]" : "[ ]"}
                </text>
                <text fg={theme.text}>Resume</text>
                <text fg={theme.textMuted}>(Ctrl+R)</text>
              </box>
              <box
                flexDirection="row"
                gap={1}
                onMouseUp={() => setSkipPermissions(!skipPermissions())}
              >
                <text fg={theme.primary}>
                  {skipPermissions() ? "[x]" : "[ ]"}
                </text>
                <text fg={theme.text}>Skip Permissions</text>
                <text fg={theme.textMuted}>(Ctrl+P)</text>
              </box>
            </box>
          </box>
        </Show>
      </box>
    )
  }

  // Step 4: Confirmation
  function ConfirmStep() {
    return (
      <box paddingLeft={4} paddingRight={4} gap={1} flexDirection="column">
        <text fg={theme.textMuted}>Review your session configuration:</text>
        <box height={1} />

        <box flexDirection="column" gap={0} backgroundColor={theme.backgroundElement} padding={1}>
          <box flexDirection="row" gap={1}>
            <box width={15}><text fg={theme.textMuted}>Tool:</text></box>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>{toolLabel()}</text>
          </box>

          <Show when={selectedTool() === "custom"}>
            <box flexDirection="row" gap={1}>
              <box width={15}><text fg={theme.textMuted}>Command:</text></box>
              <text fg={theme.text}>{customCommand()}</text>
            </box>
          </Show>

          <box flexDirection="row" gap={1}>
            <box width={15}><text fg={theme.textMuted}>Path:</text></box>
            <text fg={theme.text}>{projectPath()}</text>
          </box>

          <Show when={title()}>
            <box flexDirection="row" gap={1}>
              <box width={15}><text fg={theme.textMuted}>Title:</text></box>
              <text fg={theme.text}>{title()}</text>
            </box>
          </Show>

          <Show when={useWorktree()}>
            <box flexDirection="row" gap={1}>
              <box width={15}><text fg={theme.textMuted}>Worktree:</text></box>
              <text fg={theme.success}>Yes</text>
              <Show when={worktreeBranch()}>
                <text fg={theme.text}>({worktreeBranch()})</text>
              </Show>
              <Show when={useBaseDevelop()}>
                <text fg={theme.info}>(based on develop)</text>
              </Show>
            </box>
          </Show>

          <Show when={selectedTool() === "claude"}>
            <box flexDirection="row" gap={1}>
              <box width={15}><text fg={theme.textMuted}>Mode:</text></box>
              <text fg={theme.text}>{claudeSessionMode() === "resume" ? "Resume" : "New"}</text>
            </box>
            <Show when={skipPermissions()}>
              <box flexDirection="row" gap={1}>
                <box width={15}><text fg={theme.textMuted}>Permissions:</text></box>
                <text fg={theme.warning}>Skipped</text>
              </box>
            </Show>
          </Show>
        </box>
      </box>
    )
  }

  function getFooterHint(): string {
    if (creating()) return statusMessage()

    const step = currentStep()
    if (step === "confirm") {
      return "Enter: Create | Esc: Back"
    }
    if (step === "path" && isInGitRepo()) {
      if (!canProceed()) {
        return "Tab: Navigate | Esc: Back"
      }
      return "Tab: Navigate | Enter: Next | Esc: Back"
    }
    if (!canProceed()) {
      return "Esc: Back"
    }
    return "Enter: Next | Esc: Back"
  }

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={`New Session — ${getStepTitle(currentStep())}`} />

      <StepIndicator />

      <Switch>
        <Match when={currentStep() === "tool"}>
          <ToolStep />
        </Match>
        <Match when={currentStep() === "path"}>
          <PathStep />
        </Match>
        <Match when={currentStep() === "options"}>
          <OptionsStep />
        </Match>
        <Match when={currentStep() === "confirm"}>
          <ConfirmStep />
        </Match>
      </Switch>

      <Show when={errorMessage()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <box backgroundColor={theme.error} padding={1}>
            <text fg={theme.selectedListItemText} wrapMode="word">
              {errorMessage()}
            </text>
          </box>
        </box>
      </Show>

      <Show when={currentStep() === "confirm"}>
        <ActionButton
          label="Create Session"
          loadingLabel={`${spinnerFrames[spinnerFrame()]} ${statusMessage()}`}
          loading={creating()}
          onAction={handleCreate}
        />
      </Show>

      <DialogFooter hint={getFooterHint()} />
    </box>
  )
}
