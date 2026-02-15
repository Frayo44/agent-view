/**
 * Core types for Agent Orchestrator
 * Based on agent-deck's data model
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
}

export interface SessionForkOptions {
  sourceSessionId: string
  title?: string
  preserveHistory?: boolean
  worktreePath?: string
  worktreeRepo?: string
  worktreeBranch?: string
}

export interface Config {
  theme?: string
  defaultTool?: Tool
  defaultGroup?: string
  mcpServers?: MCPServer[]
  keybinds?: Record<string, string>
}
