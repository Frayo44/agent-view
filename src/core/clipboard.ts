import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Read text from system clipboard.
 * Attempts multiple clipboard tools based on platform.
 * Returns null if no clipboard tool is available.
 */
export async function readClipboard(): Promise<string | null> {
  const platform = process.platform

  const commands: string[] = []

  if (platform === "darwin") {
    commands.push("pbpaste")
  } else if (platform === "linux") {
    commands.push("xclip -selection clipboard -o")
    commands.push("xsel --clipboard --output")
    commands.push("powershell.exe -Command Get-Clipboard")
    commands.push("pwsh.exe -Command Get-Clipboard")
  } else if (platform === "win32") {
    commands.push("powershell.exe -Command Get-Clipboard")
  }

  for (const cmd of commands) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 2000 })
      if (stdout) return stdout
    } catch {
      continue
    }
  }

  return null
}