/**
 * Context creation helper
 * Based on OpenCode's pattern
 */

import { createContext, useContext, type ParentProps, type JSX } from "solid-js"

export interface SimpleContextOptions<T, P extends object = object> {
  name: string
  init: (props: P) => T
}

export function createSimpleContext<T, P extends object = object>(
  options: SimpleContextOptions<T, P>
) {
  const ctx = createContext<T>()

  function provider(props: ParentProps<P>): JSX.Element {
    const value = options.init(props as P)
    return <ctx.Provider value={value}>{props.children}</ctx.Provider>
  }

  function use(): T {
    const value = useContext(ctx)
    if (!value) {
      throw new Error(`use${options.name} must be used within ${options.name}Provider`)
    }
    return value
  }

  return { provider, use }
}
