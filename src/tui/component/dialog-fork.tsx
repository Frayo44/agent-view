/**
 * Fork session dialog with worktree support
 */

import { createSignal, createEffect, Show } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { isGitRepo, getRepoRoot, createWorktree, generateBranchName, sanitizeBranchName } from "@/core/git"
import type { Session } from "@/core/types"

type FocusField = "title" | "worktree" | "branch"

interface DialogForkProps {
  session: Session
}

export function DialogFork(props: DialogForkProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  // Form state
  const [title, setTitle] = createSignal(`${props.session.title} (fork)`)
  const [forking, setForking] = createSignal(false)

  // Worktree state - enabled by default for this dialog
  const [useWorktree, setUseWorktree] = createSignal(true)
  const [worktreeBranch, setWorktreeBranch] = createSignal("")
  const [isInGitRepo, setIsInGitRepo] = createSignal(false)

  // Focus state
  const [focusedField, setFocusedField] = createSignal<FocusField>("title")

  // Input refs
  let titleInputRef: InputRenderable | undefined
  let branchInputRef: InputRenderable | undefined

  // Check if session path is a git repo
  createEffect(async () => {
    try {
      const result = await isGitRepo(props.session.projectPath)
      setIsInGitRepo(result)
      if (!result) {
        setUseWorktree(false)
      }
    } catch {
      setIsInGitRepo(false)
      setUseWorktree(false)
    }
  })

  // Focus management
  createEffect(() => {
    const field = focusedField()

    if (field === "title") {
      titleInputRef?.focus()
    } else {
      titleInputRef?.blur()
    }

    if (field === "branch") {
      branchInputRef?.focus()
    } else {
      branchInputRef?.blur()
    }
  })

  function getFocusableFields(): FocusField[] {
    const fields: FocusField[] = ["title"]
    if (isInGitRepo()) {
      fields.push("worktree")
      if (useWorktree()) {
        fields.push("branch")
      }
    }
    return fields
  }

  async function handleFork() {
    if (forking()) return

    // Only Claude sessions can be forked
    if (props.session.tool !== "claude") {
      toast.show({ message: "Only Claude sessions can be forked", variant: "error", duration: 2000 })
      return
    }

    setForking(true)

    try {
      let worktreePath: string | undefined
      let worktreeRepo: string | undefined
      let worktreeBranchName: string | undefined

      // Handle worktree creation
      if (useWorktree() && isInGitRepo()) {
        const repoRoot = await getRepoRoot(props.session.projectPath)
        const branchName = worktreeBranch()
          ? sanitizeBranchName(worktreeBranch())
          : generateBranchName(title())

        worktreePath = await createWorktree(repoRoot, branchName)
        worktreeRepo = repoRoot
        worktreeBranchName = branchName
      }

      const forked = await sync.session.fork({
        sourceSessionId: props.session.id,
        title: title(),
        worktreePath,
        worktreeRepo,
        worktreeBranch: worktreeBranchName
      })

      const message = useWorktree()
        ? `Forked as ${forked.title} in worktree`
        : `Forked as ${forked.title}`
      toast.show({ message, variant: "success", duration: 2000 })

      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setForking(false)
    }
  }

  useKeyboard((evt) => {
    // Enter to fork
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleFork()
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
            Fork Session
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      {/* Source session info */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>From:</text>
          <text fg={theme.text}>{props.session.title}</text>
          <text fg={theme.accent}>({props.session.tool})</text>
        </box>
      </box>

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "title" ? theme.primary : theme.textMuted}>
          Fork Title
        </text>
        <box onMouseUp={() => setFocusedField("title")}>
          <input
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

      {/* Worktree option */}
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
              Fork into git worktree
            </text>
          </box>

          {/* Branch name input */}
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

      {/* Not a git repo warning */}
      <Show when={!isInGitRepo()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.warning}>Not in a git repository - worktree disabled</text>
        </box>
      </Show>

      {/* Fork button */}
      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={forking() ? theme.backgroundElement : theme.primary}
          padding={1}
          onMouseUp={handleFork}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {forking() ? "Forking..." : "Fork Session"}
          </text>
        </box>
      </box>

      {/* Footer */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          Tab: next field | Space: toggle | Enter: fork
        </text>
      </box>
    </box>
  )
}
