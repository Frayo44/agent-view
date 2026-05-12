import { createMemo } from "solid-js"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { listSubdirectories, isDirGitRepoSync } from "@/core/filesystem"
import path from "path"
import { existsSync } from "fs"

export interface DialogDirectoryBrowserProps {
  initialPath?: string
  onSelect: (selectedPath: string) => void
}

export function DialogDirectoryBrowser(props: DialogDirectoryBrowserProps) {
  const dialog = useDialog()
  const [currentDir, setCurrentDir] = [props.initialPath || process.cwd(), (v: string) => {
    // Mutate currentDir via dialog state trick: use DialogSelect's onSelect to navigate
    // We'll manage state through the option selection callback
    return v
  }]

  // We use a simple approach: re-render DialogSelect by pushing a new instance
  // whenever the user navigates into a subdirectory. This avoids complex state management.

  // Initial render: build options for the starting directory
  const startDir = props.initialPath || process.cwd()

  const options: DialogSelectOption<string>[] = []

  // "Select this directory" option
  if (isDirGitRepoSync(startDir)) {
    options.push({
      title: `✓ Select ${startDir} (git repo)`,
      value: startDir,
      description: "git repository",
      category: "confirm",
    })
  } else {
    options.push({
      title: `✓ Select ${startDir}`,
      value: startDir,
      description: "directory",
      category: "confirm",
    })
  }

  // "Go up" option
  const parent = path.dirname(startDir)
  if (parent !== startDir && existsSync(parent)) {
    options.push({
      title: `↩ .. (${parent})`,
      value: parent,
      description: "parent directory",
      category: "navigate",
    })
  }

  // Subdirectory options
  const subdirs = listSubdirectories(startDir)
  for (const sub of subdirs) {
    const name = path.basename(sub)
    const isGit = isDirGitRepoSync(sub)
    options.push({
      title: isGit ? `${name} ★` : name,
      value: sub,
      description: isGit ? "git repo" : "",
      category: isGit ? "git" : "directory",
    })
  }

  function handleSelect(option: DialogSelectOption<string>, ctx: DialogContext) {
    const selectedPath = option.value
    const selectedCategory = option.category

    if (selectedCategory === "confirm") {
      // User selected "Select this directory" — confirm the path
      ctx.pop()
      props.onSelect(selectedPath)
    } else {
      // User navigated into a subdirectory or went up — re-open browser at new path
      ctx.pop()
      ctx.push(() => (
        <DialogDirectoryBrowser
          initialPath={selectedPath}
          onSelect={props.onSelect}
        />
      ))
    }
  }

  return (
    <DialogSelect
      title={`Browse: ${startDir}`}
      placeholder="filter directories..."
      options={options}
      flat={true}
      onSelect={handleSelect}
    />
  )
}