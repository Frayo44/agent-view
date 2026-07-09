import { describe, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { getDirectorySuggestions, mergePathSuggestions } from "./path-suggest"

function withTempDir(run: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-path-suggest-"))
  try {
    run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe("path-suggest", () => {
  describe("getDirectorySuggestions", () => {
    test("suggests directories from cwd for empty input", () => {
      withTempDir((dir) => {
        fs.mkdirSync(path.join(dir, "alpha"))
        fs.mkdirSync(path.join(dir, "beta"))
        fs.writeFileSync(path.join(dir, "not-a-dir.txt"), "x")

        const result = getDirectorySuggestions("", { cwd: dir, home: dir })

        expect(result).toEqual(["alpha/", "beta/"])
      })
    })

    test("filters by prefix for relative input", () => {
      withTempDir((dir) => {
        fs.mkdirSync(path.join(dir, "apps"))
        fs.mkdirSync(path.join(dir, "api"))
        fs.mkdirSync(path.join(dir, "docs"))

        const result = getDirectorySuggestions("ap", { cwd: dir, home: dir })

        expect(result).toEqual(["api/", "apps/"])
      })
    })

    test("hides dot-directories unless prefix starts with dot", () => {
      withTempDir((dir) => {
        fs.mkdirSync(path.join(dir, ".cache"))
        fs.mkdirSync(path.join(dir, "project"))

        const normal = getDirectorySuggestions("", { cwd: dir, home: dir })
        expect(normal).toEqual(["project/"])

        const hidden = getDirectorySuggestions(".", { cwd: dir, home: dir })
        expect(hidden).toEqual([".cache/"])
      })
    })

    test("formats home-prefixed input as ~/...", () => {
      withTempDir((home) => {
        fs.mkdirSync(path.join(home, "workspace"))
        fs.mkdirSync(path.join(home, "workbench"))

        const result = getDirectorySuggestions("~/work", { cwd: "/tmp", home })

        expect(result).toEqual(["~/workbench/", "~/workspace/"])
      })
    })

    test("returns empty array when parent directory does not exist", () => {
      withTempDir((dir) => {
        const result = getDirectorySuggestions("does-not-exist/x", { cwd: dir, home: dir })
        expect(result).toEqual([])
      })
    })
  })

  describe("mergePathSuggestions", () => {
    test("prioritizes filesystem suggestions and deduplicates", () => {
      withTempDir((dir) => {
        fs.mkdirSync(path.join(dir, "api"))
        fs.mkdirSync(path.join(dir, "apps"))

        const merged = mergePathSuggestions("ap", ["apps/", "archive/"], {
          cwd: dir,
          home: dir
        })

        expect(merged).toEqual(["api/", "apps/", "archive/"])
      })
    })
  })
})
