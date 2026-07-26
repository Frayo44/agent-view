import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { spawnSync } from "child_process"

import { ensureHookFiles } from "./hooks"

describe("ensureHookFiles", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-hooks-test-"))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("writes settings json with Stop and Notification command hooks", () => {
    const settingsPath = ensureHookFiles(dir)

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    for (const event of ["Stop", "Notification"]) {
      const groups = settings.hooks[event]
      expect(Array.isArray(groups)).toBe(true)
      const hook = groups[0].hooks[0]
      expect(hook.type).toBe("command")
      expect(hook.command).toContain("notify.sh")
    }
  })

  test("notify.sh is valid bash and always exits 0", () => {
    ensureHookFiles(dir)
    const scriptPath = path.join(dir, "notify.sh")

    // Syntax check — catches escaping mistakes in the generated script
    const syntax = spawnSync("bash", ["-n", scriptPath])
    expect(syntax.status).toBe(0)

    // Without AGENT_ORCHESTRATOR_SESSION the script must exit 0 silently
    const run = spawnSync("bash", [scriptPath, "stop"], {
      input: "{}",
      env: { ...process.env, AGENT_ORCHESTRATOR_SESSION: "" }
    })
    expect(run.status).toBe(0)
  })

  test("notify.sh is executable", () => {
    ensureHookFiles(dir)
    const stat = fs.statSync(path.join(dir, "notify.sh"))
    expect(stat.mode & 0o100).toBeTruthy()
  })

  test("is idempotent — second call leaves files unchanged", () => {
    const settingsPath = ensureHookFiles(dir)
    const before = fs.statSync(settingsPath).mtimeMs

    ensureHookFiles(dir)
    const after = fs.statSync(settingsPath).mtimeMs

    expect(after).toBe(before)
  })
})
