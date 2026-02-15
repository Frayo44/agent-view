/**
 * Fuzzy select dialog
 * Based on OpenCode's dialog-select
 */

import { TextAttributes, RGBA, InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { useDialog, type DialogContext } from "./dialog"

export interface DialogSelectOption<T = unknown> {
  title: string
  value: T
  description?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
  onSelect?: (ctx: DialogContext) => void
}

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  flat?: boolean
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  current?: T
  keybinds?: {
    key: string
    title: string
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
}

function isEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse"
  })

  let inputRef: InputRenderable
  let scrollRef: ScrollBoxRenderable | undefined

  // Filter options
  const filtered = createMemo(() => {
    if (props.skipFilter) {
      return props.options.filter((x) => x.disabled !== true)
    }

    const needle = store.filter.toLowerCase()
    const options = props.options.filter((x) => x.disabled !== true)

    if (!needle) return options

    const result = fuzzysort
      .go(needle, options, {
        keys: ["title", "category"],
        scoreFn: (r) => (r[0]?.score ?? 0) * 2 + (r[1]?.score ?? 0)
      })
      .map((x) => x.obj)

    return result
  })

  // Reset input mode on filter change
  createEffect(() => {
    filtered()
    setStore("input", "keyboard")
  })

  const flatten = createMemo(() => props.flat && store.filter.length > 0)

  // Group by category
  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    if (flatten()) return [["", filtered()]]
    return pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      entries()
    )
  })

  // Flat list for navigation
  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options)
    )
  })

  // Calculate visible height
  const dimensions = useTerminalDimensions()
  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category) return acc
      return acc + (i > 0 ? 2 : 1)
    }, 0)
    return flat().length + headers
  })
  const height = createMemo(() => Math.min(rows(), Math.floor(dimensions().height / 2) - 6))

  const selected = createMemo(() => flat()[store.selected])

  // Reset selection on filter change
  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      setTimeout(() => {
        if (filter.length > 0) {
          moveTo(0, true)
        } else if (current) {
          const idx = flat().findIndex((opt) => isEqual(opt.value, current))
          if (idx >= 0) moveTo(idx, true)
        }
      }, 0)
    })
  )

  function move(direction: number) {
    if (flat().length === 0) return
    let next = store.selected + direction
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next, true)
  }

  function moveTo(next: number, center = false) {
    setStore("selected", next)
    const option = selected()
    if (option) props.onMove?.(option)

    if (!scrollRef) return
    const target = scrollRef.getChildren().find((child) => {
      return child.id === JSON.stringify(selected()?.value)
    })
    if (!target) return

    const y = target.y - scrollRef.y
    if (center) {
      const centerOffset = Math.floor(scrollRef.height / 2)
      scrollRef.scrollBy(y - centerOffset)
    } else {
      if (y >= scrollRef.height) {
        scrollRef.scrollBy(y - scrollRef.height + 1)
      }
      if (y < 0) {
        scrollRef.scrollBy(y)
        if (isEqual(flat()[0]?.value, selected()?.value)) {
          scrollRef.scrollTo(0)
        }
      }
    }
  }

  useKeyboard((evt) => {
    setStore("input", "keyboard")

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.name === "home") moveTo(0)
    if (evt.name === "end") moveTo(flat().length - 1)

    if (evt.name === "return") {
      const option = selected()
      if (option) {
        evt.preventDefault()
        evt.stopPropagation()
        if (option.onSelect) option.onSelect(dialog)
        props.onSelect?.(option)
      }
    }

    // Handle custom keybinds
    for (const kb of props.keybinds ?? []) {
      if (evt.name === kb.key) {
        const s = selected()
        if (s) {
          evt.preventDefault()
          kb.onTrigger(s)
        }
      }
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              inputRef = r
              setTimeout(() => {
                if (!inputRef || inputRef.isDestroyed) return
                inputRef.focus()
              }, 1)
            }}
            placeholder={props.placeholder ?? "Search"}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          maxHeight={height()}
        >
          <For each={grouped()}>
            {([category, options], index) => (
              <>
                <Show when={category}>
                  <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                      {category}
                    </text>
                  </box>
                </Show>
                <For each={options}>
                  {(option) => {
                    const active = createMemo(() => isEqual(option.value, selected()?.value))
                    const current = createMemo(() => isEqual(option.value, props.current))
                    const fg = selectedForeground(theme)

                    return (
                      <box
                        id={JSON.stringify(option.value)}
                        flexDirection="row"
                        onMouseMove={() => setStore("input", "mouse")}
                        onMouseUp={() => {
                          option.onSelect?.(dialog)
                          props.onSelect?.(option)
                        }}
                        onMouseOver={() => {
                          if (store.input !== "mouse") return
                          const idx = flat().findIndex((x) => isEqual(x.value, option.value))
                          if (idx !== -1) moveTo(idx)
                        }}
                        onMouseDown={() => {
                          const idx = flat().findIndex((x) => isEqual(x.value, option.value))
                          if (idx !== -1) moveTo(idx)
                        }}
                        backgroundColor={active() ? (option.bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                        paddingLeft={current() || option.gutter ? 1 : 3}
                        paddingRight={3}
                        gap={1}
                      >
                        <Show when={current()}>
                          <text
                            flexShrink={0}
                            fg={active() ? fg : theme.primary}
                            marginRight={0}
                          >
                            ●
                          </text>
                        </Show>
                        <Show when={!current() && option.gutter}>
                          <box flexShrink={0} marginRight={0}>
                            {option.gutter}
                          </box>
                        </Show>
                        <text
                          flexGrow={1}
                          fg={active() ? fg : current() ? theme.primary : theme.text}
                          attributes={active() ? TextAttributes.BOLD : undefined}
                          overflow="hidden"
                          wrapMode="none"
                          paddingLeft={3}
                        >
                          {option.title.slice(0, 61)}
                          <Show when={option.description}>
                            <span style={{ fg: active() ? fg : theme.textMuted }}>
                              {" "}
                              {option.description}
                            </span>
                          </Show>
                        </text>
                        <Show when={option.footer}>
                          <box flexShrink={0}>
                            <text fg={active() ? fg : theme.textMuted}>{option.footer}</text>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={props.keybinds?.length}>
        <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          <For each={props.keybinds}>
            {(kb) => (
              <text>
                <span style={{ fg: theme.text }}>
                  <b>{kb.title}</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{kb.key}</span>
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
