import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Opens a native OS folder selection dialog and returns the selected path.
 * Supports macOS, Linux (via zenity), and Windows (via PowerShell).
 * @param defaultPath Optional initial path for the dialog
 * @returns The selected folder path or null if cancelled
 */
export async function openFolderDialog(defaultPath?: string): Promise<string | null> {
  const platform = process.platform

  try {
    if (platform === "darwin") {
      let script = `choose folder with prompt "Select Project Path:"`
      if (defaultPath) {
        script += ` default location POSIX file "${defaultPath}"`
      }
      const { stdout } = await execAsync(`osascript -e 'POSIX path of (${script})'`)
      return stdout.trim() || null
    } else if (platform === "linux") {
      const { stdout } = await execAsync(`zenity --file-selection --directory --title="Select Project Path"`)
      return stdout.trim() || null
    } else if (platform === "win32") {
      const psCommand = `(New-Object -ComObject Shell.Application).BrowseForFolder(0, 'Select Project Path', 0, 0).self.path`
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCommand}"`)
      return stdout.trim() || null
    }
  } catch (err) {
    // Usually means the user cancelled the dialog
    return null
  }
  return null
}
