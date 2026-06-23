# Design Review: Workspace UX

**Review ID:** workspace_ux_20260623
**Target:** WorkspaceScreen, AgentChat, ActionPill
**Focus:** visual, usability, layout

## Summary

Floating bottom ActionPill wasted vertical space and hid project/session workflows. Fixed chrome stack: header → PanelTabs → WorkspaceToolbar → content.

**Issues addressed in implementation:**

- Critical: relocate panel tabs under header
- Major: project picker on header title; session chips in toolbar
- Major: command palette + slash commands
- Major: settings + plugin manager screens
- Major: landscape orientation support

## Positive Observations

- SSE streaming and PTY terminal architecture are solid
- Theme tokens in ThemeContext are consistent
- SessionPicker modal pattern reusable for ProjectPicker
