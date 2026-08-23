// i18n/en.ts
// Fase 6 — diccionario base (idioma por defecto). El tipo TranslationKey
// de todo el sistema de i18n se deriva de las claves de este objeto (ver
// index.ts), asi que es.ts queda obligado por TypeScript a declarar
// exactamente el mismo conjunto de claves, ni una de mas ni una de menos.
// Contenido y claves fijados en docs/glosario-traduccion-i18n.md.

export const en = {
	// 1. Paleta de comandos (src/main.ts)
	"cmd.start": "Start tracking on current task",
	"cmd.stop": "Stop active tracking",
	"cmd.openLog": "Open time log panel",
	"cmd.export": "Export time entries...",

	// 2. Status bar (src/ui/StatusBarWidget.ts)
	"statusbar.idle": "No active tracking",

	// 4. Modal de recuperacion (src/ui/RecoveryModal.ts)
	"recovery.title": "Unclosed tracking session",
	"recovery.body": 'You had "{taskText}" running since {datetime}. What do you want to do?',
	"recovery.closeNow": "Close now",
	"recovery.keepGoing": "Keep tracking",

	// 5. Modal de exportacion (src/ui/ExportModal.ts)
	"export.title": "Export sessions",
	"export.from": "From",
	"export.to": "To",
	"export.formatLabel": "Format",
	"export.formatGeneric": "Generic CSV",
	"export.formatToggl": "Toggl CSV",
	"export.formatClockify": "Clockify CSV",
	"export.togglEmailLabel": "Toggl email",
	"export.emailPlaceholder": "you@email.com",
	"export.emailRequired": "Toggl email is required to export in this format.",
	"export.emailInvalid": "That email isn't a valid format (e.g. user@domain.com).",
	"export.rangeInvalid": "Select a valid date range.",
	"export.fromAfterTo": 'The "From" field can\'t be later than "To".',
	"export.emailInvalidNotice": "Add your Toggl account email before exporting",
	"export.includeProjectClientLabel": "Include Project & Client",
	"export.includeProjectClientHelp":
		"Toggl creates the Project and Client automatically if the name doesn't match one already in your account exactly (case-sensitive) — check they match before importing to avoid duplicates.",
	"export.clockifyEmailLabel": "Clockify email",
	"export.clockifyEmailRequired": "Clockify email is required to export in this format.",
	"export.clockifyEmailInvalidNotice": "Add your Clockify account email before exporting",
	"export.includeProjectLabel": "Include Project",
	"export.clockifyIncludeProjectHelp":
		"Optional column in the Clockify CSV. Leave it unchecked to keep the file minimal — Clockify imports fine without it.",
	"export.includeClientLabel": "Include Client",
	"export.clockifyIncludeClientHelp":
		"Optional column in the Clockify CSV. Leave it unchecked to keep the file minimal — Clockify imports fine without it.",
	"export.clockifyDateFormatHeading": "Date format",
	"export.clockifyDateFormatNote":
		'This file\'s dates are in YYYY-MM-DD format — when Clockify\'s importer asks "Which date format is used in your file?", select that option.',
	"export.clockifyReimportHeading": "Avoid duplicates in Clockify",
	"export.clockifyReimportNote":
		"Importing sessions that are already in Clockify creates duplicate entries — it doesn't merge or warn you.",
	"export.exportButton": "Export",

	// 5b. Cabeceras del CSV generico (src/export/adapters/CsvAdapter.ts) —
	// a diferencia de las del CSV de Toggl (fijas, las lee su importador),
	// estas SI siguen el idioma de Obsidian: es un CSV de proposito
	// general, sin importador externo que imponga nombres de columna.
	// "tt-id" queda fuera de esta lista: es un identificador tecnico, no
	// texto de interfaz (ver docs/glosario-traduccion-i18n.md, seccion 9).
	"export.csv.headerDate": "Date",
	"export.csv.headerStartTime": "Start time",
	"export.csv.headerEndTime": "End time",
	"export.csv.headerDuration": "Duration",
	"export.csv.headerTask": "Task",
	"export.csv.headerProject": "Project",
	"export.csv.headerClient": "Client",
	"export.csv.headerSourceNote": "Source note",

	// 6. Settings (src/settings/SettingsTab.ts)
	"settings.logLocation.name": "Time Log location",
	"settings.logLocation.desc": "Where the Time Log panel opens. If it's already open, the change applies next time you open it.",
	"settings.logLocation.sidebar": "Sidebar",
	"settings.logLocation.tab": "Center tab",
	"settings.taskIdFormat.name": "Task id format",
	"settings.taskIdFormat.desc": "Only matters if you use Dataview: how the tt-id looks in its rendered view (Reading mode / Live Preview). Purely cosmetic — it doesn't change your Dataview queries on tt-id.",
	"settings.taskIdFormat.normal": "Normal",
	"settings.taskIdFormat.reduced": "Reduced",
	"settings.taskIdFormat.hidden": "Hidden",
	"settings.exportFolder.name": "Export folder",
	"settings.exportFolder.desc": "Folder inside the vault where exported files are saved. Created automatically if it doesn't exist yet.",
	"settings.exportAll.name": "Export all",
	"settings.exportAll.desc": "Your history only lives on this device. Use this button to get a backup anytime.",
	"settings.exportAll.button": "Export all",
	"settings.projects.heading": "Projects & clients",
	"settings.projects.banner":
		"Use the exact project and client names from your tracking platform (Toggl, Clockify...). Matching names is what lets sessions exported from this plugin be imported back into that platform.",
	"settings.projects.tabOneByOne": "One by one",
	"settings.projects.tabPasteList": "Paste list",
	"settings.projects.namePlaceholder": "Project name",
	"settings.projects.clientPlaceholder": "Client (optional)",
	"settings.projects.addButton": "Add",
	"settings.projects.nameRequired": "Project name is required.",
	"settings.projects.duplicateError": "This project and client combination already exists.",
	"settings.projects.pasteHelp": "One project per line — Project; Client. No client? Leave it off the line.",
	"settings.projects.importPlaceholder": "Website Redesign; Acme Inc.\nMobile App; Acme Inc.\nInternal",
	"settings.projects.importButton": "Import list",
	"settings.projects.importError":
		"Error on line {line}: '{content}' — check the rest of your list too before trying again, we only validate up to the first error.",
	"settings.projects.countSingular": "project saved",
	"settings.projects.countPlural": "projects saved",
	"settings.projects.deleteAriaLabel": "Delete project",
	"settings.projects.saveAriaLabel": "Save project",
	"settings.projects.deleteConfirmSingular": "{count} task is using this project. Delete anyway?",
	"settings.projects.deleteConfirmPlural": "{count} tasks are using this project. Delete anyway?",
	"settings.toggl.heading": "Toggl",
	"settings.toggl.email.name": "Toggl email",
	"settings.toggl.email.placeholder": "you@email.com",
	"settings.toggl.email.descValid": "Required to export sessions in Toggl CSV format.",
	"settings.toggl.includeProjectClient.name": "Include Project & Client",
	"settings.toggl.includeProjectClient.desc":
		"Toggl creates the Project and Client automatically if the name doesn't match one already in your account exactly (case-sensitive) — check they match before importing to avoid duplicates.",
	"settings.clockify.heading": "Clockify",
	"settings.clockify.email.name": "Clockify email",
	"settings.clockify.email.placeholder": "you@email.com",
	"settings.clockify.email.descValid":
		"Required to export sessions in Clockify CSV format — must match an active user in your Clockify workspace.",
	"settings.clockify.includeProject.name": "Include Project",
	"settings.clockify.includeProject.desc":
		"Optional column in the Clockify CSV. Leave it unchecked to keep the file minimal — Clockify imports fine without it.",
	"settings.clockify.includeClient.name": "Include Client",
	"settings.clockify.includeClient.desc":
		"Optional column in the Clockify CSV. Leave it unchecked to keep the file minimal — Clockify imports fine without it.",
	"settings.clockify.paymentWall.name": "Importing time entries",
	"settings.clockify.paymentWall.desc":
		"Requires a paid Clockify plan or trial. This plugin will generate the CSV either way, but Clockify won't import the time entries until your workspace has access to that feature.",

	// 7. Historial (src/ui/TimeLogView.ts)
	"log.title": "Time Tracker",
	"log.taskNotFound": "Task not found",
	"log.emptyAll": "No sessions recorded yet.",
	"log.emptyDay": "No sessions this day.",
	"log.session.singular": "session",
	"log.session.plural": "sessions",
	"log.ongoing": "ongoing",
	"log.editStartDateLabel": "Start date",
	"log.editStartTimeLabel": "Start time",
	"log.editEndDateLabel": "End date",
	"log.editEndTimeLabel": "End time",
	"log.editDurationLabel": "Calculated duration",
	"log.save": "Save",
	"log.cancel": "Cancel",
	"log.delete": "Delete",
	"log.deleteSessionConfirm": "Delete this session? This action can't be undone.",
	"log.deleteSessionYes": "Yes, delete",
	"log.errorFormat": "Check the date and times: use the HH:MM:SS format.",
	"log.errorRange": "End time must be after start time.",
	"log.errorGone": "Couldn't save: this session no longer exists.",
	"log.warnOverlap": "Note: this time overlaps with another saved session.",
	"log.deleteTaskConfirm": "Delete this task and its entire session history (all dates)? This action can't be undone.",
	"log.deleteTaskYes": "Yes, delete",
	"log.deleteBlockedActive": "Can't delete: this task has an active session. Stop tracking first.",
	"log.stopTrackingAriaLabel": "Stop tracking",
	"log.openNoteAriaLabel": "Open task note",
	"log.noteNotFoundAriaLabel": "Source note not found",
	"log.viewDay": "Day",
	"log.viewWeek": "Week",
	"log.today": "Today",
	"log.navPrevDay": "Previous day",
	"log.navNextDay": "Next day",
	"log.navPrevWeek": "Previous week",
	"log.navNextWeek": "Next week",
	"log.menuEdit": "Edit",
	"log.menuDelete": "Delete",
	"log.taskMenuAriaLabel": "Task menu",
	"log.editModalProjectLabel": "Project",
	"log.editModalNoProject": "No project",
	"log.editModalProjectUpdated": "Project updated",
	"log.editModalSessionsHeading": "Sessions",
	"log.close": "Close",
	"log.projectPicker.searchPlaceholder": "Search project or client",
	"log.projectPicker.noMatches": 'No matches for "{query}"',
	"log.filterButton": "Filter",
	"log.filterClearAriaLabel": "Clear filter",
	"log.filterRemoveButton": "Remove filter",
	"log.filterEmptyDay": "No tasks for {project} today",
	"log.filterEmptyWeek": "No tasks for {project} this week",

	// 8. Notices adicionales (src/main.ts, src/ui/TimeLogView.ts)
	"notice.noActiveSession": "No active tracking session.",
	"notice.notATask": "The current line isn't a task (checkbox).",
	"notice.taskClosed": "This task is already closed; it can't be tracked.",
	"notice.alreadyTracking": "This task is already being tracked.",
	"notice.exportSuccess": "Exported to {filePath}",
	"notice.exportError": "An error occurred while exporting. Check the console for details.",
	"notice.noSessionsYet": "No sessions saved yet.",
	"notice.noteNotFound": "Couldn't find a note for this task.",
} as const;

export type TranslationKey = keyof typeof en;
