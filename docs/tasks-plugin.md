# Using it with the Tasks plugin

If you use the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin, where the identifier sits on the line matters. Tasks only recognises its own fields (due date 📅, scheduled ⏳, start 🛫, created ➕, done ✅, priority, recurrence…) when nothing else comes after them. This is a known limitation of Tasks itself ([obsidian-tasks#1505](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/1505)) and affects any text added at the end of a task line, not just this plugin.

To avoid it, Task Time Tracker places the identifier **before** your Tasks fields, whenever you start or stop tracking a task:

`- [ ] Create profile [tt-id:: a3f9k2mp] 📅 2026-09-18`

Tasks you tracked with an older version of the plugin may still have the identifier at the end of the line, and can disappear from your Tasks queries (for example, date filters). To fix them all at once, go to **Settings → "Using the Tasks plugin?" → "Repair tasks"**. It scans your vault and only moves the identifier — nothing else on the line changes — and it's safe to run as often as you like.

---

[← Documentation index](README.md) · [Next: Clients & projects →](clients-and-projects.md)
