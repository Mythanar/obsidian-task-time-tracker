# Export

Three export formats are available whenever you need them:

- **Generic CSV** — opens cleanly in any spreadsheet tool.
- **Toggl-formatted CSV** — matches the exact columns expected by Toggl's official importer.
- **Clockify-formatted CSV** — matches the exact columns expected by Clockify's Timesheets importer. Importing time entries into Clockify needs a paid plan or trial — a limitation on Clockify's side, not this plugin's.

Generic CSV exports also include the project and client assigned to each task, if any — ready to use for per-client reporting. (The Toggl and Clockify formats can include them too, behind their "Include Project & Client" (Toggl, off by default) or "Include Project"/"Include Client" (Clockify, on by default) toggles in **Settings → Export**.)

Toggl and Clockify only import a client together with its project: sessions of a task with a client but no project are imported without a client, and a project used with several clients becomes several projects with the same name. The export dialog warns you when the chosen range has either case.

*More export formats (Harvest, Everhour, and others) are planned.*

<a href="https://toggl.com/" target="_blank"><img src="images/toggl-logo.png" alt="Toggl logo" width="150" style="border-radius:6px"></a><br>
<a href="https://clockify.me/" target="_blank"><img src="images/clockify-logo.png" alt="Clockify logo" width="150" style="border-radius:6px"></a>

---

[← Documentation index](README.md) · [Next: Updating →](updating.md)
