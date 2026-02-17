# Agent View - Terminal UI for AI Coding Agents
# Demo: Managing multiple AI coding sessions with groups

Output demo.gif
Output demo.mp4

Set Width 1200
Set Height 700
Set FontSize 14
Set TypingSpeed 35ms

# Setup - clear and launch
Hide
Type "clear"
Enter
Sleep 200ms
Show

# Launch Agent View
Type "agent-view"
Enter
Sleep 2000ms

# Show the session list with 5 sessions in 3 groups
Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# Navigate to "oncall agent" session (in research group)
# Sessions layout:
#   My Sessions (group)
#     - agent-view
#   research (group)
#     - oncall agent
#     - research claude
#   backend (group)
#     - fix loading
#     - fix login
# ═══════════════════════════════════════════════════════════════

# Go down to research group
Down
Sleep 300ms

# Expand research group
Down
Sleep 300ms

# Go to oncall agent
Down
Sleep 300ms

# Enter oncall agent session
Enter
Sleep 2000ms

# Send a command to the oncall agent
Type "What alerts are currently firing in production?"
Enter
Sleep 2500ms

# Detach back to session list
Ctrl+Q
Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# Navigate to "fix login" session (in backend group)
# From oncall agent: go down past research claude, backend group, fix loading
# ═══════════════════════════════════════════════════════════════

Down
Sleep 300ms

Down
Sleep 300ms

Down
Sleep 300ms

Down
Sleep 300ms

# Enter fix login session
Enter
Sleep 2000ms

# Send a command to fix login session
Type "Show me the current authentication flow implementation"
Enter
Sleep 2500ms

# Detach back to session list
Ctrl+Q
Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# NAVIGATE: Move between sessions to showcase navigation
# ═══════════════════════════════════════════════════════════════

Up
Sleep 400ms

Up
Sleep 400ms

Up
Sleep 400ms

Down
Sleep 400ms

Down
Sleep 400ms

Up
Sleep 400ms

Up
Sleep 400ms

Up
Sleep 400ms

Sleep 1500ms

# ═══════════════════════════════════════════════════════════════
# EXIT
# ═══════════════════════════════════════════════════════════════

Escape
Sleep 300ms

Type "q"
Sleep 500ms
