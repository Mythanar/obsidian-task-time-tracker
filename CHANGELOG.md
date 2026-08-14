# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- History panel: the "N sessions · total" summary on an actively-tracked task's card now updates live instead of only on the next external refresh (opening/closing the panel, editing a session, stopping tracking, etc.). Below one minute it ticks every second (e.g. "3s", "9s"), same pace as the card's stop-button counter; from one minute onward it switches to the compact "Xh Ym" format, redrawing only when the displayed minute changes.
- History panel: editing a session, or confirming its deletion, no longer shows a stray warning-colored border around the form — leftover debug styling from an earlier change.

## [0.0.26] - 2026-08-13

### Added

**Time tracking**
- Start and stop time tracking on any task (checkbox) in your notes, compatible with common formats: `- [ ]`, `* [ ]`, `+ [ ]`, and numbered lists, nested or not.
- An icon next to each task lets you start tracking with one click; if the task already has recorded time, its accumulated total is shown. While tracking is active, the icon switches to "stop", a pulsing dot appears, and the counter updates live. Completed tasks with recorded time show a checkmark. The badge's colors adapt to your theme's accent color.
- Only one tracking session can be active at a time: starting a new one automatically closes the previous one without losing that time.
- Tasks marked as done or cancelled can't be tracked; if one had active tracking, it stops automatically when closed.
- The Obsidian status bar always shows the active task and elapsed time (or "No active tracking" if none) — click it to open the History panel.
- If you close Obsidian with tracking active, reopening it asks whether to close that session or keep it running — it's never lost or silently discarded.

**Task linking**
- Each tracked task gets a short, unique identifier stored inline with the task text (`[tt-id:: ...]` format, compatible with Dataview queries if you use it).
- The link between a task and its time history is preserved even if you edit the task text; if you delete it, the history isn't lost — it's shown as "Task not found".
- If you use Dataview, a new "Task id format" setting lets you tone down or fully hide how the `tt-id` field looks in its rendered view (Reading mode / Live Preview) — purely visual, your Dataview queries on `tt-id` keep working exactly the same. Defaults to a toned-down look on a fresh install.

**History**
- A panel with one card per task: recorded sessions (oldest first), a compact total, and a note icon that opens the source note directly. Tap or click anywhere on a card's header to expand or collapse its sessions. The active task's card shows a stop button with a live counter, matching the style of the inline badge, and is highlighted with a subtle tint of your theme's accent color; its session details use a monospaced font for easier scanning.
- The panel title shows the total tracked time for whichever range (day or week) is currently visible.
- Day and week navigation with a single Day/Week toggle and a compact date label (e.g. "Wed, 12 Aug 2026"), plus a "Today" button that always jumps back to today's day view, even from the week view.
- Editing and deleting individual sessions, with a live preview of the calculated duration and a warning if two sessions overlap in time.
- Sessions spanning more than one calendar day show a "+N" badge with the end date, so you don't have to work it out by hand.
- Deleting a task's entire history at once.
- The panel can be placed as a sidebar or a central tab, your choice (Settings).
- Touch-friendly on mobile: no control relies on hover to become visible or usable, and tap targets are sized accordingly.

**Export**
- Export a date range to a generic CSV file, ready to open in any spreadsheet app.
- Also export in a CSV format built specifically for Toggl's native importer (the plugin never connects to the internet or calls any external API: you generate the file and upload it yourself, wherever you like).
- An "Export all" button in Settings to get your full history in one click.
- Configurable export destination folder, created automatically if it doesn't exist.

**Privacy and offline use**
- Your entire time-tracking history is stored locally in your vault. The plugin never connects to any external service, at any point — it works fully offline.

**Language**
- Available in English and Spanish, based on your Obsidian language setting.

### Fixed

- Starting tracking on a task while its note was open in more than one pane at once (a split view, or Edit and Reading mode side by side) could momentarily show it as "Task not found" in the History panel, even though the tracked time was correct.
- A "Task not found" card no longer leaves an empty gap where its note icon would be; it now shows a distinct icon and, if clicked, a short notice explaining the source note couldn't be found.
- Clicking a collapsed task card in the exact spot where its (hidden) delete button would appear once expanded no longer opens the delete confirmation by mistake — that area is now only clickable once the button is actually visible.

## [0.0.1] - 2026-08-08

### Added

- Phase 0 — initial plugin scaffold (based on obsidian-sample-plugin) with the folder structure from the roadmap.