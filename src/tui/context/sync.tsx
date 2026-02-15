/**
 * Sync context for session state management
 * Based on OpenCode's sync pattern
 */

import { createSignal, createEffect, onCleanup, batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { getStorage } from "@/core/storage"
import { getSessionManager } from "@/core/session"
import type { Session, Group, Config } from "@/core/types"
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
    }>({
      sessions: [],
      groups: [],
      config: {}
    })

    // Initial load
    const storage = getStorage()
    const manager = getSessionManager()

    // Load sessions and groups
    function refresh() {
      const sessions = storage.loadSessions()
      const groups = storage.loadGroups()

      batch(() => {
        setStore("sessions", sessions)
        setStore("groups", groups)
        if (status() === "loading") {
          setStatus("partial")
        }
      })
    }

    refresh()
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

    onCleanup(() => {
      clearInterval(pollInterval)
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
            error: store.sessions.filter((s) => s.status === "error")
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
        async delete(id: string): Promise<void> {
          await manager.delete(id)
          refresh()
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
        async fork(options: Parameters<typeof manager.fork>[0]): Promise<Session> {
          const session = await manager.fork(options)
          refresh()
          return session
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
        }
      },
      refresh
    }
  }
})
