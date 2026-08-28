# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.29] - 2026-08-28

### Added

- History panel: a new date-picker popover (calendar icon in the header) opens a full month grid to jump straight to any day or week, instead of only stepping one at a time with the arrows — click a day, click a week number, or click a second day to select an arbitrary range. Selecting a range opens a new "Results" view: sessions grouped by day, with empty days omitted entirely (a list, not a calendar), and a "Load more" button once the range covers more than 180 days. Combines with the existing project filter the same way Day/Week already do.
- Settings: a new "Clockify" section — a warning-styled banner (info icon, the theme's warning color, not the error color used for a genuinely invalid email) noting that importing time entries into Clockify needs a paid plan or trial, an email field (same validation as Toggl's), and independent "Include Project"/"Include Client" toggles (both off by default).
- `ClockifyCsvAdapter.ts`: generates a CSV with the columns Clockify's Timesheets importer expects (Email, Description, Start date, Start time, Duration always; Project and Client each only when its own toggle is on). Date, time (24h) and duration (`HH:mm`) always use fixed formats, independent of any setting. Neither Project nor Client is required by Clockify's importer, so a session missing either never blocks the export.
- Export modal: "Clockify CSV" is now a third format option, alongside "Generic CSV" and "Toggl CSV" — blocked without a valid email like the Toggl option. This completes the Clockify export flow end to end. Its informational messages are grouped into three sections, each with its own heading, separated by a divider: the "Include Project"/"Include Client" toggles (same source of truth as Settings > Clockify), "Date format" (discreet note on which option to pick in Clockify's own import dialog, since the CSV always uses `YYYY-MM-DD`), and "Avoid duplicates in Clockify" (warning-styled, since it's the modal's one real risk — importing sessions already in Clockify creates duplicate entries, and it doesn't merge or warn you).
- "Edit task" dialog: now shows the task's `tt-id` — the same identifier used in exported CSVs — as a small line under the note name, with a button to copy it to the clipboard.

### Changed

- History panel: reworked header and task-card layout for readability. Header condensed from three rows into one (Day/Week toggle, Today, date navigation, and the calendar/project-filter icons all together); added a subtitle under the panel title ("N tasks · M sessions" in Day view, "N tasks · M days with activity" in Week/Results) and a "Range total" label above the corner total. In Week/Results, each day's tasks now sit inside a single grouped container (rounded border, shared background, thin dividers between tasks) instead of separate cards with gaps between them, under a title + connector line + day-total heading. Task cards: titles now wrap to two lines before truncating (previously cut off at one), the note/kebab/project icons got explicit sizing (they were silently falling back to Obsidian's larger default), and clicking anywhere on a card (not just a small toggle) expands or collapses its sessions, with a hover highlight on desktop.
- History panel: the header's date navigation row now adapts to the panel's real width (a container query, not the window's) instead of just wrapping — the calendar and project-filter icons always stay grouped together, anchored to the right edge, whether the panel is a narrow docked sidebar or a wide central tab. The standalone "Today" button is removed from the header — it was redundant with the one already in the calendar popover's footer, which is now the single entry point back to today's view.
- Date-picker popover: removed the "Clear" button from the footer — it did exactly what "Today" already does (jump back to today's day view). "Today" is now the only reset action.

### Fixed

- Export modal: the title was rendered as its own heading inside the modal body, one line below the close (X) button instead of aligned with it. Now uses the modal's native title (same fix already applied to the "Edit task" dialog) — affects all three export formats equally, since the title doesn't depend on which one is selected.
- "Edit task" dialog: on narrow (mobile) screens, the project dropdown could overflow the dialog's width, causing horizontal scrolling and cutting off long project names.
- History panel: at panel widths roughly between 400 and 550px, the date arrows/label in the header could visually overlap the Day/Week toggle instead of adapting to the available space.
- History panel: the calendar popover could misbehave right after picking a day, week, or range from it — reopening it, or clicking the calendar icon again to close it, would sometimes do nothing, because the header rebuilds that icon on every change and the popover kept watching the old one.
- History panel: reopening the calendar while a week or a custom range was already the active view now highlights that whole range again in the grid, instead of showing only its first day as selected.
- Results view: the "Remove filters" button (previously "Remove filter") now also clears an active project filter, not just the date range, when a range comes up empty.
- "Edit task" dialog: editing a session's date could silently accept an out-of-range day (e.g. day 88) and save it as a completely different, unintended date instead of rejecting it. The date fields are now validated against the real number of days in the given month/year, and "Save" is disabled with an inline error if either date is invalid.

## [0.0.28] - 2026-08-21

### Added

- Toggl CSV export: an optional "Include Project & Client" toggle (off by default) — available in Settings > Toggl and in the export modal (shown only when "Toggl CSV" is selected), same setting either way. When on, the export adds two columns, Project and Client, using the project assigned to each task (Settings > Projects & clients). Empty for tasks without a project, or for projects without a client.

### Fixed

- Toggl CSV export now always uses the date and time format required by Toggl's importer (`YYYY-MM-DD`, 24-hour time), regardless of previous settings. The "Date format" and "Time format" selectors under Settings > Toggl are removed — Toggl's importer doesn't allow any other format, so they were never actually optional.

## [0.0.27] - 2026-08-18

### Added

- Settings: a new "Projects & clients" section lets you maintain a list of projects (with an optional client) — add them one by one or paste a whole list at once (`Project; Client` per line). This is the foundation for future export adapters (e.g. Clockify) that expect `Project`/`Client` columns, which aren't wired up yet.
- History panel: each task's card is now read-only with three independent, clickable zones — an icon to open the source note, a "⋮" menu (Edit / Delete), and the sessions line, which expands or collapses a read-only detail. Clicking anywhere else on the card no longer does anything.
- A new "Edit task" dialog (opened from the "⋮" menu) is now the only place to reassign a task's project/client (applied live, no Save button), edit a session's date/time, or delete a session — it lists the task's entire session history, not just what's currently visible in the panel. Deleting the whole task also moved here, into the "⋮" menu.
- History panel: a new "Filter" button in the header lets you filter the task list by a single project — pick one from a searchable list (each entry shows the project name and its client, if any), or clear it with the small "x" next to the button once a filter is active. The filter never persists between sessions; it resets every time you reopen Obsidian.
- Generic CSV export: two new columns, Project and Client, right after Task — the project assigned to each task (Settings > Projects & clients), if any. Empty for tasks without a project, or for projects without a client. The Toggl CSV format isn't affected.

### Fixed

- History panel: the "N sessions · total" summary on an actively-tracked task's card now updates live instead of only on the next external refresh (opening/closing the panel, editing a session, stopping tracking, etc.). Below one minute it ticks every second (e.g. "3s", "9s"), same pace as the card's stop-button counter; from one minute onward it switches to the compact "Xh Ym" format, redrawing only when the displayed minute changes.
- History panel: editing a session, or confirming its deletion, no longer shows a stray warning-colored border around the form — leftover debug styling from an earlier change.
- History panel: tasks with a session recorded on the current day could briefly show as "Task not found" right after a cold start of Obsidian, until you expanded that task's card. Fixed a race condition where the panel's first render could run before an already-open note had finished loading its content into the editor.
- Generic CSV export: column headers were hardcoded in Spanish, regardless of Obsidian's language setting. Now they follow Obsidian's language, same as the rest of the plugin's interface (the Toggl CSV format was never affected).

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