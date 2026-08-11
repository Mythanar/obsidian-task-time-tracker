# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

**History**
- A panel with one card per task: recorded sessions, total time, and a direct link to the source note. The active task's card shows a stop button with a live counter, matching the style of the inline badge.
- Day and week navigation, with a "Today" button to jump back to the current date.
- Editing and deleting individual sessions, with a warning if two sessions overlap in time.
- Deleting a task's entire history at once.
- The panel can be placed as a sidebar or a central tab, your choice (Settings).

**Export**
- Export a date range to a generic CSV file, ready to open in any spreadsheet app.
- Also export in a CSV format built specifically for Toggl's native importer (the plugin never connects to the internet or calls any external API: you generate the file and upload it yourself, wherever you like).
- An "Export all" button in Settings to get your full history in one click.
- Configurable export destination folder, created automatically if it doesn't exist.

**Privacy and offline use**
- Your entire time-tracking history is stored locally in your vault. The plugin never connects to any external service, at any point — it works fully offline.

**Language**
- Available in English and Spanish, based on your Obsidian language setting.

## [0.0.1] - 2026-08-08

### Added

- Phase 0 — initial plugin scaffold (based on obsidian-sample-plugin) with the folder structure from the roadmap.
