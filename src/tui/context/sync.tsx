/**
 * Sync context for session state management
 * Based on OpenCode's sync pattern
 */

import { createSignal, createEffect, onCleanup, batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { getStorage } from "@/core/storage"
import { getSessionManager } from "@/core/session"
import { getRemoteManager } from "@/core/remote"
import type { Session, Group, Config, RemoteSession } from "@/core/types"
import { isRemoteSession } from "@/core/types"
import { createSimpleContext } from "./helper"

export type SyncStatus = "loading" | "partial" | "complete"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [status, setStatus] = createSignal<SyncStatus>("loading")
    const [store, setStore] = createStore<{
      sessions: Session[]
      groups: Group[]
      config: Config
      remoteSessions: RemoteSession[]
    }>({
      sessions: [],
      groups: [],
      config: {},
      remoteSessions: []
    })

    // In-memory reactive store for per-session memory usage (KB)
    const [memoryStore, setMemoryStore] = createStore<Record<string, number>>({})

    // Initial load
    const storage = getStorage()
    const manager = getSessionManager()
    const remoteManager = getRemoteManager()

    // Load sessions and groups
    function refresh() {
      const sessions = storage.loadSessions()
      const groups = storage.loadGroups()

      // Build memory snapshot from manager
      const mem: Record<string, number> = {}
      for (const s of sessions) {
        const kb = manager.getMemoryKB(s.id)
        if (kb !== undefined) mem[s.id] = kb
      }

      batch(() => {
        setStore("sessions", sessions)
        setStore("groups", groups)
        setMemoryStore(mem)
        if (status() === "loading") {
          setStatus("partial")
        }
      })
    }

    // Refresh remote sessions (async, doesn't block)
    async function refreshRemote(force = false) {
      try {
        const remoteSessions = await remoteManager.fetchAllSessions(force)
        setStore("remoteSessions", remoteSessions)
      } catch {
        // Ignore errors - remote sessions are optional
      }
    }

    refresh()
    refreshRemote()
    setStatus("complete")

    // Start refresh loop
    manager.startRefreshLoop(500)

    // Poll for changes (simple approach)
    let lastModified = storage.lastModified()
    const pollInterval = setInterval(() => {
      const newModified = storage.lastModified()
      if (newModified !== lastModified) {
        lastModified = newModified
        refresh()
      }
    }, 200)

    // Poll remote sessions less frequently (every 10 seconds)
    const remotePollInterval = setInterval(() => {
      refreshRemote()
    }, 10000)

    onCleanup(() => {
      clearInterval(pollInterval)
      clearInterval(remotePollInterval)
      manager.stopRefreshLoop()
    })

    return {
      get status() {
        return status()
      },
      get data() {
        return store
      },
      session: {
        get(id: string): Session | undefined {
          return store.sessions.find((s) => s.id === id)
        },
        list(): Session[] {
          return store.sessions
        },
        byStatus() {
          return {
            running: store.sessions.filter((s) => s.status === "running"),
            waiting: store.sessions.filter((s) => s.status === "waiting"),
            idle: store.sessions.filter((s) => s.status === "idle"),
            stopped: store.sessions.filter((s) => s.status === "stopped"),
            error: store.sessions.filter((s) => s.status === "error"),
            hibernated: store.sessions.filter((s) => s.status === "hibernated")
          }
        },
        byGroup(): Map<string, Session[]> {
          const groups = new Map<string, Session[]>()
          for (const session of store.sessions) {
            const existing = groups.get(session.groupPath) || []
            existing.push(session)
            groups.set(session.groupPath, existing)
          }
          return groups
        },
        async create(options: Parameters<typeof manager.create>[0]): Promise<Session> {
          const session = await manager.create(options)
          refresh()
          return session
        },
        async delete(id: string, options?: { deleteWorktree?: boolean }): Promise<void> {
          await manager.delete(id, options)
          refresh()
        },
        async resume(id: string): Promise<Session> {
          const session = await manager.resume(id)
          refresh()
          return session
        },
        async restart(id: string): Promise<Session> {
          const session = await manager.restart(id)
          refresh()
          return session
        },
        async stop(id: string): Promise<void> {
          await manager.stop(id)
          refresh()
        },
        async hibernate(id: string): Promise<void> {
          await manager.hibernate(id)
          refresh()
        },
        async fork(options: Parameters<typeof manager.fork>[0]): Promise<Session> {
          const session = await manager.fork(options)
          refresh()
          return session
        },
        async canFork(id: string): Promise<boolean> {
          return manager.canFork(id)
        },
        rename(id: string, title: string): void {
          manager.updateTitle(id, title)
          refresh()
        },
        moveToGroup(id: string, groupPath: string): void {
          manager.moveToGroup(id, groupPath)
          refresh()
        },
        getMemoryMB(id: string): number | undefined {
          const kb = memoryStore[id]
          if (kb === undefined || kb <= 0) return undefined
          return Math.round(kb / 1024)
        },
        drainAutoHibernated() {
          return manager.drainAutoHibernated()
        }
      },
      group: {
        get(path: string): Group | undefined {
          return store.groups.find((g) => g.path === path)
        },
        list(): Group[] {
          return store.groups
        },
        save(groups: Group[]): void {
          storage.saveGroups(groups)
          refresh()
        },
        delete(path: string): void {
          storage.deleteGroup(path)
          refresh()
        },
        toggle(path: string): void {
          const groups = store.groups.map((g) =>
            g.path === path ? { ...g, expanded: !g.expanded } : g
          )
          storage.saveGroups(groups)
          refresh()
        },
        create(name: string): void {
          const path = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group"
          // Ensure unique path
          let finalPath = path
          let counter = 1
          while (store.groups.some(g => g.path === finalPath)) {
            finalPath = `${path}-${counter}`
            counter++
          }
          const newGroup: Group = {
            path: finalPath,
            name,
            expanded: true,
            order: store.groups.length,
            defaultPath: ""
          }
          storage.saveGroups([...store.groups, newGroup])
          refresh()
        },
        rename(path: string, newName: string): void {
          const groups = store.groups.map((g) =>
            g.path === path ? { ...g, name: newName } : g
          )
          storage.saveGroups(groups)
          refresh()
        }
      },
      remote: {
        list(): RemoteSession[] {
          return store.remoteSessions
        },
        async refresh(): Promise<void> {
          await refreshRemote(true)
        },
        async stop(session: RemoteSession): Promise<void> {
          await remoteManager.stopSession(session)
          await refreshRemote(true)
        },
        async restart(session: RemoteSession): Promise<void> {
          await remoteManager.restartSession(session)
          await refreshRemote(true)
        },
        async delete(session: RemoteSession): Promise<void> {
          await remoteManager.deleteSession(session)
          await refreshRemote(true)
        },
        async hibernate(session: RemoteSession): Promise<void> {
          await remoteManager.hibernateSession(session)
          await refreshRemote(true)
        },
        async resume(session: RemoteSession): Promise<void> {
          await remoteManager.resumeSession(session)
          await refreshRemote(true)
        },
        attach(session: RemoteSession): boolean {
          return remoteManager.attachSession(session)
        },
        async create(remoteName: string, options: {
          title?: string
          projectPath: string
          tool: string
          group?: string
          command?: string
        }): Promise<{ success: boolean; error?: string }> {
          const result = await remoteManager.createSession(remoteName, options)
          if (result.success) {
            await refreshRemote(true)
          }
          return result
        },
              },
      refresh,
      refreshRemote
    }
  }
})
