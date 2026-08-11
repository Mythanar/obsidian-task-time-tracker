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
	"export.togglEmailLabel": "Toggl email",
	"export.emailPlaceholder": "you@email.com",
	"export.emailRequired": "Toggl email is required to export in this format.",
	"export.emailInvalid": "That email isn't a valid format (e.g. user@domain.com).",
	"export.rangeInvalid": "Select a valid date range.",
	"export.fromAfterTo": 'The "From" field can\'t be later than "To".',
	"export.emailInvalidNotice": "Add your Toggl account email before exporting",
	"export.exportButton": "Export",

	// 6. Settings (src/settings/SettingsTab.ts)
	"settings.logLocation.name": "Time Log location",
	"settings.logLocation.desc": "Where the Time Log panel opens. If it's already open, the change applies next time you open it.",
	"settings.logLocation.sidebar": "Sidebar",
	"settings.logLocation.tab": "Center tab",
	"settings.exportFolder.name": "Export folder",
	"settings.exportFolder.desc": "Folder inside the vault where exported files are saved. Created automatically if it doesn't exist yet.",
	"settings.exportAll.name": "Export all",
	"settings.exportAll.desc": "Your history only lives on this device. Use this button to get a backup anytime.",
	"settings.exportAll.button": "Export all",
	"settings.toggl.heading": "Toggl",
	"settings.toggl.email.name": "Toggl email",
	"settings.toggl.email.placeholder": "you@email.com",
	"settings.toggl.email.descValid": "Required to export sessions in Toggl CSV format.",
	"settings.toggl.dateFormat.name": "Date format",
	"settings.toggl.dateFormat.iso": "ISO (YYYY-MM-DD)",
	"settings.toggl.dateFormat.dmy": "DD-MM-YYYY",
	"settings.toggl.dateFormat.mdy": "MM-DD-YYYY",
	"settings.toggl.timeFormat.name": "Time format",
	"settings.toggl.timeFormat.24h": "24-hour",
	"settings.toggl.timeFormat.12h": "12-hour (AM/PM)",

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
	"log.deleteTaskAriaLabel": "Delete task",
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
