# Implementation Plan: Window Navigation

## Feature Summary

Extend the home screen sidebar to show tmux windows as expandable sub-items under sessions. Press Right arrow or Enter on a session to expand its windows; selecting a window shows that window's output in the preview pane. No config toggle needed — windows always show in the hierarchy.

## Files Modified

- `src/core/types.ts` — add `TmuxWindow` interface
- `src/core/tmux.ts` — add `listWindows()`, `selectWindowSync()` functions
- `src/tui/util/groups.ts` — extend `GroupedItem` for window type
- `src/tui/routes/home.tsx` — window expansion, `WindowItem`, window-specific capture

## Dependencies

None. This PR is independent.

---

## Stage 2.1: tmux Window Listing

Add the ability to list windows for a tmux session.

### Steps

#### 2.1.1 Add `TmuxWindow` type
**File:** `src/core/types.ts`

Add interface:
```typescript
export interface TmuxWindow {
  index: number
  name: string
  active: boolean  // true if this is the currently active window
}
```

#### 2.1.2 Add `listWindows()` function
**File:** `src/core/tmux.ts`

Add function using `execFileAsync` (NOT `execAsync`) to avoid shell escaping issues with `\t`:
```typescript
import { execFile } from "child_process"
import { promisify } from "util"
const execFileAsync = promisify(execFile)

export async function listWindows(sessionName: string): Promise<TmuxWindow[]> {
  // Use execFile to avoid shell escaping issues with format strings containing \t
  const args = tmuxSpawnArgs(
    "list-windows", "-t", sessionName,
    "-F", "#{window_index}\t#{window_name}\t#{window_active}"
  )
  const { stdout } = await execFileAsync("tmux", args)
  return stdout.trim().split("\n").filter(Boolean).map(line => {
    const parts = line.split("\t")
    return {
      index: parseInt(parts[0]!, 10),
      name: parts[1] || "",
      active: parts[2] === "1"
    }
  })
}
```

#### 2.1.3 Add `selectWindowSync()` function
**File:** `src/core/tmux.ts`

Add function for selecting a window before attaching:
```typescript
export function selectWindowSync(sessionName: string, windowIndex: number): void {
  try {
    execSync(tmuxCmd(`select-window -t "${sessionName}:${windowIndex}"`), { timeout: 3000 })
  } catch {
    // Window might not exist
  }
}
```

**Important:** Ensure `execFileAsync` and `TmuxWindow` are properly imported.

**Success criteria:** `listWindows("agentorch_test-abc")` returns an array of `TmuxWindow` objects for the given session.

#### 2.1.4 Extend `GroupedItem` for windows
**File:** `src/tui/util/groups.ts`

Add `"window"` to the `GroupedItem.type` union and add optional fields:
```typescript
export interface GroupedItem {
  type: "group" | "session" | "window"
  group?: Group
  session?: Session
  window?: TmuxWindow
  groupPath: string
  isLast: boolean
  groupIndex?: number
  sessionExpanded?: boolean  // true if this window's parent session is expanded
}
```

Note: `TmuxWindow` must be imported from `@/core/types`.

**Success criteria:** TypeScript compiles. Existing `flattenGroupTree()` callers still work (windows are only added separately, not by `flattenGroupTree`).

---

## Stage 2.2: Window Navigation in Home Screen

Add window sub-items under sessions in the home screen sidebar.

### Steps

#### 2.2.1 Add window expansion state to Home component
**File:** `src/tui/routes/home.tsx`

Add signals:
```typescript
const [expandedSessions, setExpandedSessions] = createSignal<Set<string>>(new Set())
const [sessionWindows, setSessionWindows] = createSignal<Map<string, TmuxWindow[]>>(new Map())
```

Add helper to toggle session expansion and fetch windows:
```typescript
async function toggleSessionWindows(session: Session) {
  const key = session.id
  const expanded = new Set(expandedSessions())
  if (expanded.has(key)) {
    expanded.delete(key)
  } else {
    expanded.add(key)
    // Fetch windows for this session
    if (session.tmuxSession) {
      try {
        const windows = await listWindows(session.tmuxSession)
        setSessionWindows(prev => new Map(prev).set(key, windows))
      } catch {
        // tmux session might not exist
      }
    }
  }
  setExpandedSessions(expanded)
}
```

#### 2.2.2 Create flat items list with windows
**File:** `src/tui/routes/home.tsx`

Create a new memo that extends `groupedItems()` with window sub-items:
```typescript
const flatItems = createMemo(() => {
  const items: GroupedItem[] = []
  const expanded = expandedSessions()
  const windows = sessionWindows()

  for (const item of groupedItems()) {
    items.push(item)
    if (item.type === "session" && item.session && expanded.has(item.session.id)) {
      const wins = windows.get(item.session.id) || []
      for (let i = 0; i < wins.length; i++) {
        items.push({
          type: "window",
          window: wins[i],
          session: item.session,
          groupPath: item.groupPath,
          isLast: i === wins.length - 1,
          sessionExpanded: true,
        })
      }
    }
  }
  return items
})
```

Update `selectedIndex` bounds, `move()`, `selectedItem`, `selectedSession` to use `flatItems` instead of `groupedItems`.

#### 2.2.3 Add `WindowItem` component
**File:** `src/tui/routes/home.tsx`

Add component (similar to `SessionItem` but for windows):
```typescript
function WindowItem(props: { window: TmuxWindow; session: Session; index: number }) {
  const isSelected = createMemo(() => props.index === selectedIndex())
  return (
    <box
      flexDirection="row"
      paddingLeft={5}  // indent under session
      paddingRight={1}
      height={1}
      backgroundColor={isSelected() ? theme.primary : undefined}
      onMouseUp={() => setSelectedIndex(props.index)}
      onMouseOver={() => setSelectedIndex(props.index)}
    >
      <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
        {props.window.active ? "▶" : " "}
      </text>
      <text> </text>
      <text fg={isSelected() ? theme.selectedListItemText : theme.text}>
        {props.window.name}
      </text>
    </box>
  )
}
```

#### 2.2.4 Handle session expand/collapse on Right
**File:** `src/tui/routes/home.tsx`

Modify the Right arrow handler to check if a session has windows. Use Right arrow to expand windows (like groups), Enter to attach. This is consistent with the group/session pattern.

Modify Right arrow handler:
```typescript
if (evt.name === "right" || evt.name === "l") {
  const item = selectedItem()
  if (item?.type === "group" && item.group && !item.group.expanded) {
    sync.group.toggle(item.group.path)
  } else if (item?.type === "session" && item.session) {
    // If session has windows and isn't expanded, expand windows
    const isExpanded = expandedSessions().has(item.session.id)
    if (item.session.tmuxSession && !isExpanded) {
      toggleSessionWindows(item.session)
    } else {
      handleAttach(item.session)
    }
  }
}
```

Also modify Enter handler to expand windows on first press:
```typescript
if (evt.name === "return") {
  const item = selectedItem()
  if (item?.type === "session" && item.session) {
    const isExpanded = expandedSessions().has(item.session.id)
    if (item.session.tmuxSession && !isExpanded) {
      toggleSessionWindows(item.session)
    } else {
      handleAttach(item.session)
    }
  }
  // ... existing group/window handlers
}
```

Add Left arrow collapse for windows:
```typescript
if (evt.name === "left" || evt.name === "h") {
  const item = selectedItem()
  if (item?.type === "window" && item.session) {
    toggleSessionWindows(item.session)
  }
  // ... existing group handlers
}
```

#### 2.2.5 Capture window-specific output in preview
**File:** `src/tui/routes/home.tsx`

Modify the preview capture effect to target a specific window when one is selected:
```typescript
const captureTarget = createMemo(() => {
  const item = selectedItem()
  if (item?.type === "window" && item.session?.tmuxSession && item.window) {
    return `${item.session.tmuxSession}:${item.window.index}`
  }
  const session = selectedSession()
  return session?.tmuxSession || ""
})
```

Update the `capturePane` call in the preview effect to use `captureTarget()` instead of `session.tmuxSession`.

#### 2.2.6 Update the rendering loop
**File:** `src/tui/routes/home.tsx`

Switch from `groupedItems()` to `flatItems()` in the scrollbox rendering, adding a case for `window` type:
```tsx
<For each={flatItems()}>
  {(item, index) => renderFlatItem(item, index())}
</For>
```

Where `renderFlatItem` dispatches to `GroupHeader`, `WindowItem`, or `SessionItem` based on `item.type`.

**Success criteria:**
- Pressing Right on a session with windows expands to show window list
- Selecting a window shows that window's output in the preview pane
- Enter on a session still attaches (after expanding windows)
- Groups still expand/collapse as before

---

## Risk Areas

1. **Window fetch latency:** `listWindows()` spawns a subprocess per session expansion. Should be fast (< 100ms) but could be slow on heavily loaded systems. Mitigation: fetch once and cache per session.
