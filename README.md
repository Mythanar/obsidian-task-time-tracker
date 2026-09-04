

# Task Time Tracker

 <img src="docs/images/ttt-logo-dark.png" width="300" alt="Task Time Tracker logo">
 

A local-first Obsidian plugin for **tracking time directly on the checkboxes in your notes** — compatible with the Tasks plugin format, with no external services involved at any point.

**Obsidian has no native way to track time on your work**. Existing plugins mostly focus on Pomodoro-style sessions, or don't integrate with the checkbox-based task format already used across vaults — and none of them combine tracking with exporting your time to the tools you already use.

 <a href="https://community.obsidian.md/plugins/task-time-tracker">➔ Install it from the Obsidian Community Plugins directory.</a>


<img src="docs/images/obsidian-dark-29.png" alt="Task Time Tracker plugin shown in Obsidian, with a note open and the History panel visible" width="100%" style="max-width:800px; margin-bottom:1rem; border-radius:10px;">

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Projects & clients](#projects--clients)
- [Dashboard](#dashboard)
- [Commands](#commands)
- [Privacy & architecture](#privacy--architecture)
- [Export](#export)
- [Installation](#installation)
- [About](#about)
- [License](#license)

## How it works

1. **Open a note** with a checkbox task — no special setup or template required.
2. **Start tracking** from a command or the icon next to the task's checkbox.
3. **Watch the status bar** — a live timer shows the task name and elapsed time as you work.
4. **Stop when you're done** — one click closes the session. Switching tasks does this automatically.
5. **Check off the task — and tracking wraps up on its own**. Marking a task done (or cancelled) stops any active tracking automatically and saves the session, no extra step needed. Reopen the task later and you can pick up tracking again.
6. **Review your history** — sessions grouped by task. Step through Day or Week with the arrows, or open the calendar to jump straight to any date, pick a week, or select a custom range — a range opens a dedicated Results view, sessions grouped by day with a running total.

<img src="docs/images/badges-demo.gif" alt="Animated demo of the task badge states — play, active tracking, and completed" width="450" style="border-radius:12px; margin:2rem 0;">

### Where you can interact with the tracker

The play/stop icon and the live counter only appear where Obsidian renders an editable view of the note — that is, in **Edit/Source mode** on the note itself.

They won't appear in any read-only rendering of the task, even though the task and its recorded time are exactly the same underlying data. This includes:
- **Reading mode**
- **Embedded notes** (`![[note#^block]]`)
- **Any query or dataview-style result** (Tasks, Dataview, or similar plugins) — these render a non-editable visualization of the task, not the task itself

To start or stop tracking, switch to Edit mode on the note, or use the **History panel** — which works everywhere, regardless of how the task is normally displayed.

The status bar at the bottom of Obsidian always shows the active task (or "No active tracking"). Clicking anywhere on it opens the History panel — this works regardless of the note's mode, and even with no timer running.

<img src="docs/images/status-bar-dark.png" alt="Status bar, clickable to open History" style="border-radius:12px;">


### The task identifier

Every tracked task gets a short, unique identifier stored inline with the task text (`[tt-id:: ...]`), so your history stays linked to the right task even if you edit or move it. Keeping your notes uncluttered matters to us, so this identifier is **subtle by default** — and you're never stuck with how it looks out of the box:

- Go to **Settings → Task identifier format** to choose between **Normal** (fully visible), **Reduced** (small and low-opacity — the default), or **Hidden** entirely.
- This styling requires the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin — Dataview is what renders the identifier at all, so it's also what makes it queryable (e.g. `WHERE tt-id = "..."`) and stylable. **Dataview is entirely optional**: tracking, history, and export all work exactly the same without it.
- Without Dataview installed, the identifier is shown as plain text (e.g. `[tt-id:: a3f9k2mp]`) — this is a known limitation of relying on Dataview for the styling, not a bug.
- In Source mode, the raw identifier is always visible regardless of this setting, so you can always find and inspect it if needed. It's also shown — with a one-click copy button — in the **Edit task** dialog, the quickest way to grab it without switching to Source mode.

**Normal** — shown as Dataview would normally render any inline field.

<img src="docs/images/id-normal-dark.png" alt="Task identifier, Normal visibility mode" style="border-radius:12px;">

**Reduced** *(default)* — same information, styled to blend in and stay out of the way while you read your notes.

<img src="docs/images/id-reduced-dark.png" alt="Task identifier, Reduced visibility mode" style="border-radius:12px;">

**Hidden** — the identifier isn't rendered at all, though it's still there in the note and your Dataview queries on `tt-id` keep working.

<img src="docs/images/id-hidden-dark.png" alt="Task identifier, Hidden visibility mode" style="border-radius:12px;">

## Features

- **Local-first, always available** — tracking works entirely offline. The plugin never depends on network access for day-to-day use.
- **One timer, no confusion** — only one active timer at a time. Switching tasks closes the previous session automatically, without losing data.
- **Fits your task format** — works with Tasks-style checkboxes (`- [ ]`, `* [ ]`, `+ [ ]`), numbered lists, and nested tasks.
- **Plays nicely with Dataview, but never depends on it** — an optional, subtle-by-default identifier keeps your history linked to each task and makes it queryable, without cluttering your notes.
- **A clear history** — a dedicated panel with per-task cards, day/week navigation or any custom date range, and inline editing or deletion of sessions.
- **Organize with projects & clients** — group your tasks under projects (each with an optional client) from Settings, then filter the History panel down to a single one at a time.
- **A 30-day overview at a glance** — the Dashboard view totals your last 30 days by project, client, day, and task, no filters or setup needed.
- **Export on your terms** — generate a generic CSV or one formatted for Toggl's official importer. You choose when to export — never automatic, never in the background.
- **Zero external API calls** — the plugin never connects to any third-party service, at any point in its operation. Your time data stays in your vault.

<img src="docs/images/history-panel-29.png" alt="The History panel, showing a couple of expanded task cards" width="415" style="border-radius:12px;margin:2rem 0;">

## Projects & clients

Group your tasks by project, and optionally by client, right from Settings.

<img src="docs/images/project-and-clients-settings.png" alt="Settings → Projects & clients section" width="515" style="border-radius:12px;margin:2rem 0;">

Add projects one by one, or paste a whole list at once (`Project; Client` per line) if you're migrating from somewhere else.

Assign a project to any tracked task from its **Edit task** dialog — pick one from a searchable list, each row showing the project and its client if it has one.


<img src="docs/images/project-picker-modal-29.png" alt="Project picker inside Edit task" width="515" style="border-radius:12px;margin:2rem 0;">

Once you're tracking by project, filter the History panel down to a single one at a time with the **Filter** button in its header. The filter resets every time you reopen Obsidian, so it's never a setting you forget you left on.

<img src="docs/images/filter-in-panel-29.png" alt="Filter button + popover in the History panel header" width="515" style="border-radius:12px;margin:2rem 0;">

## Dashboard

A dedicated view for a no-filter overview of your last 30 days — opened from its own icon in the ribbon, with the total for the window shown right next to its title.

<img src="docs/images/dashboard-ribbon-30.png" alt="Dashboard icon in the ribbon" width="180" style="border-radius:12px;margin:2rem 0;">

Four blocks share the same row format as the rest of the plugin (name + total time in `HH:MM:SS` + number of sessions):

- **By project** and **by client** — ranked by total time, with a "No project"/"No client" row for anything not assigned.
- **By day** — chronological (most recent first), not ranked, since it's a timeline rather than a leaderboard.
- **By task** — ranked by total time; if a task's source note was deleted, its name still shows (in italics) instead of an error.

Day and task blocks show the top 5 by default, with a "Show all" link loading 50 more at a time. The 30-day window is fixed — no range picker or extra filters, since the four blocks already break the same data down by project, client, day, and task.

<img src="docs/images/dashboard-30.png" alt="Dashboard panel" width="415" style="border-radius:12px;margin:2rem 0;">


## Commands

All actions are also available from Obsidian's Command Palette (`Cmd/Ctrl + P`), so you're never dependent on hovering over a checkbox or finding the status bar:

- **Time Tracker: Start tracking on current task** — starts tracking the task under your cursor.
- **Time Tracker: Stop active tracking** — stops whatever timer is currently running.
- **Time Tracker: Open time log panel** — opens the History panel.
- **Time Tracker: Export time entries...** — opens the export dialog to generate a CSV (generic, Toggl-formatted, or Clockify-formatted) for a chosen date range.

## Privacy & architecture

Task Time Tracker never calls an external API — not for tracking, not for exporting, not for anything.

Every session is stored locally in your vault. When you export, the plugin writes a file to disk; nothing is transmitted anywhere. You take that file and upload it yourself, whenever you choose, to the native importer of whichever platform you use.

This isn't a missing feature waiting to be built. It's a deliberate architectural decision: your time data is yours, and it doesn't leave your machine unless you decide to move it. The same philosophy applies to what the plugin puts inside your notes: the task identifier is the only thing it ever writes there, and it stays as unobtrusive as possible by default.

To keep a task linked to its history even if you move or rename its note, the plugin reads across your vault's markdown files looking for its tt-id — this stays entirely on your device, like everything else here, and is never transmitted anywhere. The one-click copy button next to the tt-id in the Edit task dialog uses your operating system's clipboard, exactly like any other copy button you'd find in Obsidian.

## Export

Three export formats are available whenever you need them:

- **Generic CSV** — opens cleanly in any spreadsheet tool.
- **Toggl-formatted CSV** — matches the exact columns expected by Toggl's official importer.
- **Clockify-formatted CSV** — matches the exact columns expected by Clockify's Timesheets importer. Importing time entries into Clockify needs a paid plan or trial — a limitation on Clockify's side, not this plugin's.

Generic CSV exports also include the project and client assigned to each task, if any — ready to use for per-client reporting. (The Toggl and Clockify formats can include them too, each behind its own "Include Project"/"Include Client" toggle in Settings — off by default.)

*More export formats (Harvest, Everhour, and others) are planned.*

<a href="https://toggl.com/" target="_blank"><img src="docs/images/toggl-logo.png" alt="Toggl logo" width="150" style="border-radius:6px"></a><br>
<a href="https://clockify.me/" target="_blank"><img src="docs/images/clockify-logo.png" alt="Clockify logo" width="150" style="border-radius:6px"></a>


## Installation

**Option A — Obsidian Community Plugins (recommended)**

1. Open Settings → Community plugins in Obsidian.
2. Click Browse and search for "Task Time Tracker".
3. Click Install, then Enable.

**Option B — BRAT** (for beta versions ahead of the official release)
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Community Plugins.
2. In BRAT's settings, add this repository: `Mythanar/obsidian-task-time-tracker`.
3. Enable Task Time Tracker in Community Plugins.

**Option C — Manual**
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Mythanar/obsidian-task-time-tracker/releases).
2. Create a folder named `task-time-tracker` inside your vault's `.obsidian/plugins/` directory and place the three files there.
3. Reload Obsidian and enable the plugin in Community Plugins.

## About

Built by [Mythanar](https://mythanar.com). This plugin started as something I needed for myself, built alongside AI, because I couldn't find one that did what I actually wanted. If it works for me, maybe it'll work for someone else too.

<a href='https://ko-fi.com/V1G5250ECI' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>


## License

[MIT](LICENSE)