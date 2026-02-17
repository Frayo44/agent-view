/**
 * Core types for Agent Orchestrator
 * Based on agent-view's data model
 */

export type SessionStatus =
  | "running"     // Agent is actively working
  | "waiting"     // Agent needs input/approval
  | "idle"        // Session exists but agent is not active
  | "error"       // Session has an error
  | "stopped"     // Session was explicitly stopped

export type Tool =
  | "claude"      // Claude Code
  | "opencode"    // OpenCode
  | "gemini"      // Gemini CLI
  | "codex"       // OpenAI Codex CLI
  | "custom"      // Custom command
  | "shell"       // Plain shell

export interface Session {
  id: string
  title: string
  projectPath: string
  groupPath: string
  order: number
  command: string
  wrapper: string
  tool: Tool
  status: SessionStatus
  tmuxSession: string
  createdAt: Date
  lastAccessed: Date
  parentSessionId: string
  worktreePath: string
  worktreeRepo: string
  worktreeBranch: string
  toolData: Record<string, unknown>
  acknowledged: boolean
}

export interface Group {
  path: string
  name: string
  expanded: boolean
  order: number
  defaultPath: string
}

export interface StatusUpdate {
  sessionId: string
  status: SessionStatus
  tool: Tool
  acknowledged: boolean
}

export interface MCPServer {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

export interface MCPStatus {
  server: MCPServer
  connected: boolean
  error?: string
}

export type ClaudeSessionMode = "new" | "resume"

export interface ClaudeOptions {
  sessionMode: ClaudeSessionMode
}

export interface SessionCreateOptions {
  title?: string
  projectPath: string
  groupPath?: string
  tool: Tool
  command?: string
  wrapper?: string
  parentSessionId?: string
  worktreePath?: string
  worktreeRepo?: string
  worktreeBranch?: string
  claudeOptions?: ClaudeOptions
}

export interface SessionForkOptions {
  sourceSessionId: string
  title?: string
  preserveHistory?: boolean
  worktreePath?: string
  worktreeRepo?: string
  worktreeBranch?: string
}

export interface WorktreeConfig {
  defaultBaseBranch?: string
  command?: string
  autoCleanup?: boolean
}

export interface Config {
  theme?: string
  defaultTool?: Tool
  defaultGroup?: string
  worktree?: WorktreeConfig
  mcpServers?: MCPServer[]
  keybinds?: Record<string, string>
}

export function getToolCommand(tool: Tool, customCmd?: string): string {
  switch (tool) {
    case "claude":
      return "claude"
    case "opencode":
      return "opencode"
    case "gemini":
      return "gemini"
    case "codex":
      return "codex"
    case "custom":
      return customCmd || process.env.SHELL || "/bin/bash"
    case "shell":
    default:
      return process.env.SHELL || "/bin/bash"
  }
}
