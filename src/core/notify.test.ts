import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import { consumeSignals, clearSignalsFor } from "./notify"

describe("notification signals", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-notify-test-"))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function writeSignal(sessionId: string, timestampSec: number, event = "stop") {
    fs.writeFileSync(
      path.join(dir, `${sessionId}.json`),
      JSON.stringify({ event, sessionId, timestamp: timestampSec })
    )
  }

  test("consumes fresh signals and deletes the files", () => {
    writeSignal("abc", Math.floor(Date.now() / 1000))

    const signals = consumeSignals(dir)

    expect(signals).toHaveLength(1)
    expect(signals[0]?.sessionId).toBe("abc")
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })

  test("drops stale signals but still deletes the files", () => {
    writeSignal("old", Math.floor(Date.now() / 1000) - 120)

    const signals = consumeSignals(dir)

    expect(signals).toHaveLength(0)
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })

  test("survives malformed signal files", () => {
    fs.writeFileSync(path.join(dir, "bad.json"), "not json{")
    writeSignal("good", Math.floor(Date.now() / 1000))

    const signals = consumeSignals(dir)

    expect(signals).toHaveLength(1)
    expect(signals[0]?.sessionId).toBe("good")
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })

  test("returns empty when the directory does not exist", () => {
    expect(consumeSignals(path.join(dir, "missing"))).toEqual([])
  })

  test("clearSignalsFor removes only that session's signal", () => {
    writeSignal("keep", Math.floor(Date.now() / 1000))
    writeSignal("drop", Math.floor(Date.now() / 1000))

    clearSignalsFor("drop", dir)

    expect(fs.readdirSync(dir).sort()).toEqual(["keep.json"])
  })
})
