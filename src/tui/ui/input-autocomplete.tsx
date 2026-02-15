/**
 * Autocomplete input component
 * Wraps standard input with dropdown suggestions
 */

import { createSignal, createMemo, For, Show, batch, createEffect, on } from "solid-js"
import { TextAttributes, RGBA, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme, selectedForeground } from "@tui/context/theme"

export interface InputAutocompleteProps {
  value: string
  onInput: (value: string) => void
  suggestions: string[]
  onSelect?: (value: string) => void
  maxSuggestions?: number
  placeholder?: string
  focusedBackgroundColor?: RGBA
  cursorColor?: RGBA
  focusedTextColor?: RGBA
  ref?: (r: InputRenderable) => void
  focused?: boolean
  onFocus?: () => void
}

export function InputAutocomplete(props: InputAutocompleteProps) {
  const { theme } = useTheme()
  const [selectedIdx, setSelectedIdx] = createSignal(-1)
  const [showSuggestions, setShowSuggestions] = createSignal(false)
  const [inputMode, setInputMode] = createSignal<"keyboard" | "mouse">("keyboard")

  let inputRef: InputRenderable | undefined

  const maxSuggestions = props.maxSuggestions ?? 5

  // Filter and limit suggestions
  const visibleSuggestions = createMemo(() => {
    const suggestions = props.suggestions || []
    return suggestions.slice(0, maxSuggestions)
  })

  // Reset selection when suggestions change
  createEffect(
    on([visibleSuggestions], () => {
      setSelectedIdx(-1)
    })
  )

  // Show suggestions when there are any and input is focused
  createEffect(() => {
    const hasSuggestions = visibleSuggestions().length > 0
    const hasValue = props.value.length > 0
    // Show suggestions when we have them, but only if there's no value OR value matches partial suggestion
    setShowSuggestions(hasSuggestions)
  })

  function selectSuggestion(value: string) {
    batch(() => {
      props.onInput(value)
      props.onSelect?.(value)
      setShowSuggestions(false)
      setSelectedIdx(-1)
    })
  }

  function moveSelection(direction: number) {
    const suggestions = visibleSuggestions()
    if (suggestions.length === 0) return

    setInputMode("keyboard")

    let next = selectedIdx() + direction
    // Allow -1 to go back to input
    if (next < -1) next = suggestions.length - 1
    if (next >= suggestions.length) next = -1

    setSelectedIdx(next)
  }

  useKeyboard((evt) => {
    // Only handle if we have suggestions visible
    if (!showSuggestions() || visibleSuggestions().length === 0) return

    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      moveSelection(1)
      return
    }

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      moveSelection(-1)
      return
    }

    if (evt.name === "tab" && !evt.shift) {
      // Tab accepts the current selection
      const idx = selectedIdx()
      const suggestions = visibleSuggestions()
      if (idx >= 0 && idx < suggestions.length) {
        evt.preventDefault()
        const suggestion = suggestions[idx]
        if (suggestion) selectSuggestion(suggestion)
      } else if (suggestions.length > 0 && suggestions[0]) {
        // If nothing selected, select first
        evt.preventDefault()
        selectSuggestion(suggestions[0])
      }
      return
    }

    if (evt.name === "return") {
      // Enter accepts the current selection if any
      const idx = selectedIdx()
      const suggestions = visibleSuggestions()
      if (idx >= 0 && idx < suggestions.length) {
        evt.preventDefault()
        const suggestion = suggestions[idx]
        if (suggestion) selectSuggestion(suggestion)
      }
      // Let return propagate if no selection
      return
    }

    if (evt.name === "escape") {
      // Escape closes suggestions
      setShowSuggestions(false)
      setSelectedIdx(-1)
      return
    }
  })

  const fg = selectedForeground(theme)

  return (
    <box>
      <box
        onMouseUp={() => {
          props.onFocus?.()
          inputRef?.focus()
        }}
      >
        <input
          placeholder={props.placeholder}
          value={props.value}
          onInput={(value) => {
            props.onInput(value)
            setShowSuggestions(true)
            setSelectedIdx(-1)
          }}
          focusedBackgroundColor={props.focusedBackgroundColor ?? theme.backgroundElement}
          cursorColor={props.cursorColor ?? theme.primary}
          focusedTextColor={props.focusedTextColor ?? theme.text}
          ref={(r) => {
            inputRef = r
            props.ref?.(r)
          }}
        />
      </box>
      <Show when={showSuggestions() && visibleSuggestions().length > 0}>
        <box paddingTop={0} paddingLeft={1}>
          <For each={visibleSuggestions()}>
            {(suggestion, idx) => {
              const isSelected = () => selectedIdx() === idx()

              return (
                <box
                  flexDirection="row"
                  onMouseMove={() => setInputMode("mouse")}
                  onMouseOver={() => {
                    if (inputMode() === "mouse") {
                      setSelectedIdx(idx())
                    }
                  }}
                  onMouseUp={() => selectSuggestion(suggestion)}
                  backgroundColor={isSelected() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    fg={isSelected() ? fg : theme.textMuted}
                    attributes={isSelected() ? TextAttributes.BOLD : undefined}
                    overflow="hidden"
                    wrapMode="none"
                  >
                    {suggestion}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
