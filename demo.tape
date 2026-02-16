# Agent View - Terminal UI for AI Coding Agents
# Showcase: managing multiple AI coding sessions

Output demo.gif
Output demo.mp4

Set Width 1920
Set Height 1080
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
Sleep 1500ms

# Show the session list with 3 existing sessions
Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# SESSION 2: Navigate to second session
# ═══════════════════════════════════════════════════════════════
Down
Sleep 300ms

Enter
Sleep 3000ms

# Give a task
Type "Fix the login bug where users get logged out after refresh"
Enter
Sleep 2500ms

# Detach back to session list
Ctrl+Q
Sleep 800ms

# ═══════════════════════════════════════════════════════════════
# SESSION 1: Navigate to first session
# ═══════════════════════════════════════════════════════════════
Up
Sleep 300ms

Enter
Sleep 3000ms

# Give a task
Type "Add dark mode toggle to the settings page"
Enter
Sleep 2500ms

# Detach back to session list
Ctrl+Q
Sleep 800ms

# ═══════════════════════════════════════════════════════════════
# NAVIGATE: Show session list and preview
# ═══════════════════════════════════════════════════════════════
Up
Sleep 400ms

Up
Sleep 400ms

Down
Sleep 400ms

Sleep 1000ms

# ═══════════════════════════════════════════════════════════════
# EXIT
# ═══════════════════════════════════════════════════════════════

Escape
Sleep 300ms

Type "q"
Sleep 200ms
