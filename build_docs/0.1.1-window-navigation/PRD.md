# Product Requirements Document: Window Navigation

## Overview

Extending the sidebar hierarchy from Groups > Sessions to Groups > Sessions > Windows, allowing users to see and navigate to individual tmux windows from the TUI.

## Problem Statement

The sidebar only shows sessions, not the windows within them — users cannot see or navigate to individual tmux windows from the TUI.

## Goals

- Show tmux windows as a navigable sub-level under sessions in the sidebar
- Allow selecting a window to preview its output
- No config toggle needed — windows always show in the hierarchy (expanded via arrow keys)

## Non-Goals

- Per-pane capture or navigation — only window-level granularity
- Window navigation in the always-visible sidebar (that is PR 3, which depends on this PR)

## Requirements

### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-9 | List tmux windows | should | Sidebar shows tmux windows as expandable items under each session |
| FR-10 | Window-level output capture | should | Selecting a window in the sidebar captures that specific window's output in the preview pane |
| FR-12 | Settings dialog exposure | must | New settings (if any) appear in the `c` settings dialog |

Note: This PR does not add a settings toggle. FR-12 is listed for completeness since other PRs in this feature set add settings. This PR has no user-facing settings.

### Non-Functional Requirements

| ID | Requirement | Priority | Target |
|----|-------------|----------|--------|
| NFR-2 | Performance of window listing | should | Window list fetch adds < 100ms latency per session expansion |

## User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|------------|----------|
| US-6 | power user | see windows under each session in the sidebar | I can navigate to specific windows without full attach | should |
| US-7 | power user | select a window to preview its output | I can monitor what's happening in each window | should |

## Success Criteria

- Pressing Right on a session with windows expands to show window list
- Selecting a window shows that window's output in the preview pane
- Enter on a session still attaches (after expanding windows)
- Groups still expand/collapse as before

## Dependencies

- Existing `capturePane()` in `tmux.ts` for output capture
- Existing `flattenGroupTree()` in `groups.ts` for sidebar structure

## Implementation Notes

The `listWindows()` function must use `execFileAsync` with `tmuxSpawnArgs()` (not `execAsync` with `tmuxCmd()`) to avoid shell escaping bugs with `\t` in the tmux format string `#{window_index}\t#{window_name}\t#{window_active}`. The original implementation using `execAsync` had a bug where the shell interpreted `\t` as a tab character in the command string, corrupting the output.
