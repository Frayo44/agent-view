#!/usr/bin/env bun

import path from "path"
import solidPlugin from "@opentui/solid/bun-plugin"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "external",
  minify: false,
  plugins: [solidPlugin],
  external: ["bun:sqlite", "node-pty"],
})

if (!result.success) {
  console.error("Build failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("Build successful!")
console.log(`Output: ${result.outputs.map(o => o.path).join(", ")}`)
