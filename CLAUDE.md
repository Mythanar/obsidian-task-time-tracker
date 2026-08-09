# Contexto del proyecto: Task Time Tracker

Plugin de Obsidian en TypeScript para trackear tiempo de tareas (checkboxes,
formato compatible con el plugin Tasks) de forma LOCAL, con exportacion
manual y por lotes a plataformas externas (Toggl y otras a futuro).

## Reglas de arquitectura no negociables
1. Local-first: ningun flujo de start/stop depende de red.
2. Exportacion = generacion de archivos (CSV u otros formatos) compatibles
   con el importador nativo de cada plataforma externa (Toggl, Clockify,
   Harvest, etc.). El plugin NUNCA llama a ninguna API externa, en ningun
   punto del codigo, no solo fuera de ExportManager. Nunca sync en tiempo
   real. El usuario sube el archivo manualmente a la plataforma que
   corresponda, usando el importador que esa plataforma ya ofrece.
3. El modelo de datos vive en data.json del plugin (saveData/loadData de la
   API de Obsidian), no se escribe estado interno en las notas del usuario,
   salvo el identificador inline necesario para vincular la tarea. Formato
   confirmado en Fase 2: `[tt-id:: <id>]`, con corchetes (requerido por
   Dataview para reconocerlo como inline field estructurado), id nanoid
   alfanumerico de 8 caracteres.
4. No aplica gestion de tokens/credenciales de API dentro del plugin, ya
   que ningun adapter de exportacion llama a una API externa. Tampoco
   aplica idempotencia via `externalId` de una plataforma remota — cada
   adapter de exportacion genera un archivo nuevo e independiente; evitar
   duplicados al importarlo es responsabilidad del usuario y/o del propio
   importador de cada plataforma (algunas, como Toggl, ya deduplican por
   su cuenta filas identicas en fecha/hora de inicio). Los ajustes
   especificos de cada plataforma que SI hacen falta (p.ej. email y
   formato de fecha/hora para Toggl) son campos manuales en settings,
   nunca se consultan via API ni siquiera en modo solo lectura.
5. Un solo timer activo a la vez (no tracking paralelo) en el MVP.

## Estructura de carpetas
/src
  main.ts                 # entry point del plugin, registra comandos y vistas
  /core
    TrackingEngine.ts      # start/stop, timer activo, persistencia de entries
    TaskIdentifier.ts      # genera/lee el id inline [tt-id:: <id>], resuelve conflictos
  /ui
    StatusBarWidget.ts      # timer activo en status bar
    TimeLogView.ts          # panel lateral con historial
    ExportModal.ts          # modal de seleccion de rango + formato de destino
  /export
    ExportManager.ts        # orquesta exportacion, elige el adapter de formato
    /adapters
      CsvAdapter.ts          # CSV generico, agnostico de plataforma (Fase 3)
      TogglCsvAdapter.ts      # genera el CSV de importacion de Toggl (Fase 4):
                               # columnas Email, Description, Start date,
                               # Start time, Duration unicamente. Sin Task ni
                               # Billable (plan de pago), sin Client/Project
                               # (el plugin no tiene ese concepto). No llama a
                               # la API de Toggl en ningun momento.
      (backlog explicito, sin fecha: ClockifyAdapter.ts, HarvestAdapter.ts,
       EverhourAdapter.ts, TimelyAdapter.ts — mismo patron cuando se
       prioricen: generar el archivo que el importador de cada plataforma
       espera, sin tocar su API)
  /settings
    SettingsTab.ts           # configuracion del plugin, organizada en
                              # secciones. "General": placeholder para Fase 5,
                              # sin contenido funcional todavia. "Toggl":
                              # campos manuales (email, formato de fecha/hora)
                              # que TogglCsvAdapter.ts necesita para generar el
                              # CSV — nunca se consultan via API. No gestiona
                              # tokens/API keys de ninguna plataforma externa.
  types.ts

## Estado actual
Fase 3 completada (exportacion CSV generica). Fase 4 redefinida el 9 de
agosto de 2026 (ver docs/DECISIONES.md, "Fase 4 — redefinicion completa")
y su alcance/formato cerrados ese mismo dia (ver "Fase 4 — alcance y
formato cerrados"): solo Toggl por ahora, CSV con Email/Description/
Start date/Start time/Duration, email y formato de fecha/hora como
campos manuales en settings. Pendiente de implementar.

## Como trabajar
- Construye por fases segun el roadmap (Fase 0 -> 5), no todo de una vez.
- Antes de construir el adapter de exportacion de cada plataforma (Toggl,
  Clockify, etc.), confirma con el usuario el formato exacto que espera su
  importador (columnas, estructura, requisitos de cuenta/permisos) —
  mismo principio de "investigar antes de codear" que regia para la API,
  aplicado ahora a formato de archivo en vez de a endpoints.
- Usa la API publica de Obsidian (Plugin, Notice, ItemView, addCommand,
  addStatusBarItem, loadData/saveData); evita hacks sobre el DOM interno
  de Obsidian salvo que sea estrictamente necesario.
- Sigue las convenciones del plugin de ejemplo oficial de Obsidian
  (obsidian-sample-plugin) para manifest.json, esbuild config y estructura.