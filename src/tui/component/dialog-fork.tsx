/**
 * Fork session dialog with worktree support
 */

import { createSignal, createEffect, Show } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog, scrollDialogBy, scrollDialogTo } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import { isGitRepo, getRepoRoot, createWorktree, generateBranchName, sanitizeBranchName } from "@/core/git"
import { canFork } from "@/core/claude"
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

  // Fork eligibility state
  const [canForkSession, setCanForkSession] = createSignal(true)
  const [checkingForkEligibility, setCheckingForkEligibility] = createSignal(true)

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

  // Check fork eligibility (active Claude session required)
  createEffect(async () => {
    setCheckingForkEligibility(true)
    try {
      const result = await canFork(props.session.projectPath)
      setCanForkSession(result)
    } catch {
      setCanForkSession(false)
    } finally {
      setCheckingForkEligibility(false)
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

    // Check fork eligibility
    if (!canForkSession()) {
      toast.show({
        message: "Cannot fork: no active Claude session detected (session must be running)",
        variant: "error",
        duration: 3000
      })
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
    // Block all interaction while forking
    if (forking()) {
      evt.preventDefault()
      return
    }

    // Enter to fork (only if eligible)
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      if (canForkSession() && !checkingForkEligibility()) {
        // Blur inputs before forking
        titleInputRef?.blur()
        branchInputRef?.blur()
        handleFork()
      }
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

    // Space to toggle worktree checkbox
    if (focusedField() === "worktree" && evt.name === "space") {
      evt.preventDefault()
      setUseWorktree(!useWorktree())
      return
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Fork Session" />

      {/* Source session info */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>From:</text>
          <text fg={theme.text}>{props.session.title}</text>
          <text fg={theme.accent}>({props.session.tool})</text>
        </box>
      </box>

      {/* Fork eligibility warning */}
      <Show when={!checkingForkEligibility() && !canForkSession()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.error}>
            No active Claude session detected. The session must be running with an active conversation to fork.
          </text>
        </box>
      </Show>

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "title" ? theme.primary : theme.textMuted}>
          Fork Title
        </text>
        <box onMouseUp={() => !forking() && setFocusedField("title")}>
          <input
            value={title()}
            onInput={setTitle}
            focusedBackgroundColor={forking() ? theme.background : theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={forking() ? theme.textMuted : theme.text}
            ref={(r) => {
              titleInputRef = r
              setTimeout(() => {
                if (focusedField() === "title" && !forking()) {
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
              <box onMouseUp={() => !forking() && setFocusedField("branch")}>
                <input
                  placeholder="auto-generated from title if empty"
                  value={worktreeBranch()}
                  onInput={(v) => !forking() && setWorktreeBranch(v)}
                  focusedBackgroundColor={forking() ? theme.background : theme.backgroundElement}
                  cursorColor={theme.primary}
                  focusedTextColor={forking() ? theme.textMuted : theme.text}
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

      <ActionButton
        label={!canForkSession() ? "Cannot Fork" : "Fork Session"}
        loadingLabel={checkingForkEligibility() ? "Checking..." : "Forking..."}
        loading={forking() || checkingForkEligibility()}
        disabled={!canForkSession()}
        onAction={handleFork}
      />

      <DialogFooter hint="Tab: next field | Space: toggle | Enter: fork" />
    </box>
  )
}
