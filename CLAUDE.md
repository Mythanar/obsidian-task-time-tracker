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
   su cuenta filas identicas en fecha/hora de inicio).
5. Un solo timer activo a la vez (no tracking paralelo) en el MVP.
6. La vault del usuario es su casa, no la nuestra. Cualquier cosa que el
   plugin escriba o dibuje dentro de una nota (identificadores inline,
   badges, marcas de cualquier tipo) debe justificar su presencia, y por
   defecto debe usar la opcion menos intrusiva que siga siendo funcional.
   Si hace falta dejar una marca visible, el aspecto por defecto es el
   mas discreto posible sin romper la funcion; ir a un aspecto mas
   visible o mas completo es una eleccion explicita del usuario (via
   Settings), nunca el punto de partida de una instalacion nueva. Ejemplo
   aplicado: el `[tt-id:: <id>]` se renderiza (via Dataview) en estilo
   Reducido por defecto, con Normal y Oculto como opciones explicitas en
   Settings > Task identifier format.

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
      TogglCsvAdapter.ts      # genera CSV con las columnas que espera el
                               # importador oficial de Toggl (Fase 4). No llama
                               # a la API de Toggl en ningun momento.
      (futuros: ClockifyAdapter.ts, HarvestAdapter.ts, EverhourAdapter.ts,
       TimelyAdapter.ts, etc. — mismo patron: generar el archivo que el
       importador de cada plataforma espera, sin tocar su API)
  /settings
    SettingsTab.ts           # configuracion del plugin (formato de export,
                              # carpeta de destino, formato del tt-id). No
                              # gestiona tokens/API keys de ninguna plataforma
                              # externa.
  /i18n
    en.ts, es.ts             # diccionarios de traduccion (Fase 6). Ingles por
                              # defecto, espanol si Obsidian esta en ese idioma.
                              # NO se traduce: el identificador `[tt-id:: <id>]`
                              # inline, las columnas de los CSV de exportacion,
                              # ni los nombres de archivos/carpetas de export.
  types.ts

## Estado actual
Fases 0 a 6 completadas y probadas en Obsidian (tracking local, vinculacion
robusta de tareas, exportacion CSV generica y CSV para Toggl, mejoras de UX,
i18n en/es). En curso la Fase 7 (checklist de pre-release, sin funcionalidad
de producto nueva): licencia, verificacion en mobile, bug del doble panel
con la misma nota abierta en varios paneles (corregido — ver
docs/DECISIONES.md), README con contenido completo e ilustrado. Ver
docs/DECISIONES.md para el detalle fase a fase.

## Como trabajar
- Construye por fases segun el roadmap (Fase 0 -> 7), no todo de una vez.
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
- Ante cualquier bug que dependa de timing o de estado en memoria (p. ej.
  varios paneles con la misma nota abierta a la vez), instrumenta con
  logging temporal con timestamps antes de proponer un fix — no se
  diagnostica a ciegas. Retira el logging antes de cualquier commit.