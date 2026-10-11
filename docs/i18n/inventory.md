# Inventario de cadenas i18n — Folder Lab (fase 1)

Auditoría completa del repositorio (101 archivos TS + JSON/CSS/manifest). Cada fila: clave propuesta · texto original (es) · ubicaciones · interp. El catálogo máquina fuente es `src/i18n/locales/es.json` (474 hojas ≈ 400 claves semánticas); este documento añade ubicación y contexto. `[DUP]` = misma clave compartida por varias ubicaciones (significado idéntico).

Criterios de exclusión aplicados (ver §Excluidos): `console.*`, comentarios, identificadores, rutas, formatos persistidos (`|STATUS|`, ids de estado, claves de datos), marcas idénticas en todos los idiomas, placeholders técnicos, código muerto y diagnóstico interno.

## 1. common / acciones genéricas (compartidas)

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| common.appName | Folder Lab | main.ts:376, FolderLabView.ts:458 | no |
| common.cancel | Cancelar | ModalUtils.ts:52,110, WordCountModal.ts:270, BoardPolishModal.ts:78, LibraryBrowser.ts:527,823, AddResourceModal.ts:80, browser.ts:202 | no |
| common.accept | Aceptar | ModalUtils.ts:58 | no |
| common.confirm | Confirmar | ModalUtils.ts:117 | no |
| common.close | Cerrar | FocusWorkspace.ts:205 | no |
| common.select | Seleccionar | LibraryBrowser.ts:834, browser.ts:211 | no |
| common.apply | Aplicar | LibraryBrowser.ts:536, MemoryWidget.ts:276 | no |
| common.add | Agregar | AddResourceModal.ts:84 | no |
| common.delete | Eliminar | NoteItemComponent.ts:243, NoteItemRenderer.ts:395, NoteListComponent.ts:1027 | no |
| common.error / unknownError | Error / Error desconocido | main.ts:1067, MemoryWidget.ts:922, AIService.ts:34,57 | no |
| common.notApplicable | N/A | WordCountService.ts:133,136 | no |

## 2. Encabezado y navegación (header, toolbar, árbol)

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| actions.createNoteOrFolder | Crear nota o carpeta | HeaderComponent.ts:121 | no |
| actions.compile | Compilar | HeaderComponent.ts:133 | no |
| actions.countWords | Contar palabras | HeaderComponent.ts:142 | no |
| actions.recentNotes | Notas recientes | HeaderComponent.ts:159 | no |
| actions.recentNotesActive | Volver a notas de la carpeta | FolderLabView.ts:299,325 | no |
| actions.recentNotesInactive | Mostrar notas recientes | FolderLabView.ts:305 | no |
| actions.allNotes | Mostrar todas las notas | HeaderComponent.ts:178, FolderLabView.ts:328 | no |
| actions.showFolders | Ver carpetas | HeaderComponent.ts:197, FolderLabView.ts:317 | no |
| actions.hideFolders | Ocultar carpetas | FolderLabView.ts:314 | no |
| actions.filterNotes | Filtrar notas | HeaderComponent.ts:216, FolderLabView.ts:351 | no |
| actions.filterActive | Filtro activo | FolderLabView.ts:345 | no |
| actions.back | Volver al padre | HeaderComponent.ts:322 (unifica variante :100 "Volver a carpeta anterior") | no |
| navigation.propertiesRootTitle | Navegación por propiedades | FolderLabView.ts:1317, PropertyNavigationProvider.ts:283 | no |
| navigation.rootFallback | Raíz | FolderNavigationProvider.ts:53 | no |
| navigation.providerFolders / providerProperties | Carpetas y archivos / Propiedades de las notas | FolderNavigationProvider.ts:10, PropertyNavigationProvider.ts:10, main.ts:752-753,770 | no |

## 3. Estadísticas del encabezado (headerStats, StatsComponent)

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| stats.headerPlaceholder | 0 notas · 0 subcarpetas | HeaderComponent.ts:86 | no |
| stats.note.one/other | nota/notas | headerStats.ts:110,148 | plural |
| stats.totalNote.one/other | nota total/notas totales | headerStats.ts:115 | plural |
| stats.folder.one/other | carpeta/carpetas | headerStats.ts:119,152 | plural |
| stats.zeroNotes | 0 notas | headerStats.ts:157 | no |
| stats.percentCompleted | « · {percentage} % completado» | headerStats.ts:131 | sí |
| stats.goalTooltip | {words} / {target} palabras | headerStats.ts:132 | sí |
| stats.foldersListed | {count} carpetas | headerStats.ts:172 | sí |
| stats.notesListed | {count} notas | headerStats.ts:182 | sí |
| stats.recentFiles | {count} archivos recientes | headerStats.ts:192 | sí |
| stats.compactProgress / compactEmpty | {notes} notas · {percentage}% completado / 0 notas · 0% completado | StatsComponent.ts:43,45 | sí/no |

## 4. Estados vacíos

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| empty.noElements | No hay elementos para mostrar | NoteListComponent.ts:135, FolderLabView.ts:1695 | no |
| empty.noFilterMatch | No hay notas que coincidan con el filtro | NoteListComponent.ts:185 | no |
| empty.folderNotFound | Carpeta no encontrada | FolderLabView.ts:1272, ExportService.ts:126,209 | no |
| empty.noRecentNotes | No hay notas recientes | FolderLabView.ts:1533,1575 | no |
| empty.noSubfolders | No hay subcarpetas para mostrar | FolderLabView.ts:1754 | no |
| empty.combinedModeSoon | Modo combinado (próximamente) | FolderLabView.ts:2216 | no |
| empty.noRootFolders | No hay carpetas en la raíz del vault | main.ts:77,718 | no |

## 5. Notas y estados de nota

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| notes.create.menuItem/prompt/defaultName | Nueva nota / Nombre de la nueva nota: / Nueva nota | FolderLabController.ts:676,173,173 | no |
| notes.created / deleted | Nota creada: {name} / Nota eliminada: {name} | NoteService.ts:64,253; FolderLabController.ts:610 | sí |
| notes.quickAreaPlaceholder | Escribe tus apuntes aquí… | NoteAreaComponent.ts:43 | no |
| notes.status.* | Nota vacía / Haz clic para cambiar/establecer estado / Establecer estado / {label} - Haz clic… | NoteItemComponent.ts:119-137, NoteItemRenderer.ts:185-207,310,331 | parcial |
| notes.statusMenu.none | Sin estado | NoteItemRenderer.ts:345 | no |
| notes.reorderTodoNotice | Reordenamiento (TODO) | NoteItemComponent.ts:221 | no |
| actions.regenerateCompile | Regenerar compilado | NoteItemComponent.ts:155,233, NoteItemRenderer.ts:139,260, NoteListComponent.ts:995 | no |
| actions.openNoteContext | Abrir contexto de nota | NoteItemRenderer.ts:383 | no |
| statuses.draft…noStatus (13) | Borrador…Sin estado | statuses.ts:45-56,71 → menús/filtros | no |

## 6. Carpetas y creación

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| folders.create.menuItem/prompt | Nueva carpeta / Nombre de la nueva carpeta: | FolderLabController.ts:685,214 | no |
| folders.created | Carpeta creada: {name} | FolderLabController.ts:245 | sí |
| errors.folder.* | nombre inválido / ya existe "{name}" / no se pudo crear | FolderLabController.ts:221,228,236 | parcial |
| folders.contextMenu.openInFolderLab | Abrir en Folder Lab | main.ts:393 | no |

## 7. Filtros

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| filters.all/empty/noStatus | Todas las notas / Notas vacías / Sin estado | FilterService.ts:17,23,24 (y 50-52 código muerto) | no |
| filters.clear | ✕ Limpiar filtro | FilterMenu.ts:49 | no |

## 8. Exportación / compilado

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| export.copyListTxt | Copiar lista (TXT) | FolderLabController.ts:654 | no |
| export.exportAllNotes | Exportar todas las notas | FolderLabController.ts:656 | no |
| export.generatingCompile | 📚 Generando compilado... | ExportService.ts:122 | no |
| export.compiledUpdated/Created | Compilado actualizado/creado: {name} | ExportService.ts:170,173 | sí |
| export.listCopiedToClipboard | Lista copiada al portapapeles | ExportService.ts:99 | no |
| export.indexFileCreated | {fileName} creado | ExportService.ts:104 | sí |
| export.subfoldersSoon | Exportando todas las subcarpetas... (próximamente) | ExportService.ts:190 | no |
| export.noNotesSelected | No hay notas seleccionadas | ExportService.ts:202 | no |
| export.selectionFileCreated / selectionExportError | ✅ {fileName} creado / ❌ Error al exportar selección | ExportService.ts:223,226 | sí/no |
| export.document.pendingContent/noNotes/selectionHeading | *[Contenido pendiente]* / *No hay notas para compilar* / # {folder} (selección) | ExportService.ts:144,154,162,213 | sí/no/sí |

## 9. Errores y avisos (controlador, servicios, vista)

| Clave | es | Ubicaciones | Interp |
|---|---|---|---|
| errors.noRootConfigured | ❌ No hay carpeta raíz configurada… | FolderLabController.ts:113 | no |
| errors.initFailed / initProject | ❌ No fue posible inicializar… / ❌ Error al inicializar… | FolderLabController.ts:153, main.ts:421 | no |
| errors.noFolderSelected (+Marked) | No hay carpeta seleccionada (±❌) | FolderLabController.ts:169,210,598,640,649, NoteService.ts:34, ExportService.ts:48,117 | no |
| errors.noFolderOrFileSelected | No hay carpeta o archivo seleccionado | NoteService.ts:242 | no |
| errors.noCurrentFolder / alreadyAtRoot | No hay carpeta actual / Ya estás en la carpeta raíz | FolderLabController.ts:367,340,374 | no |
| errors.note.* | Archivo no válido / nombre vacío / ya existe "{name}" / error al eliminar | FolderLabController.ts:592,615, NoteService.ts:39,47 | parcial |
| errors.wordCount.* | sin raíz / error al contar / no se pudo actualizar | FolderLabController.ts:493,502, FolderLabView.ts:994 | no |
| errors.focus.noActiveNote | No hay nota activa para el modo Focus | FolderLabView.ts:419 | no |
| errors.board.* | No hay una nota activa. / vista no encontrada. / Board no encontrado. | FolderLabView.ts:915,929,949 | no |
| errors.navigation.nodeNotFound | ❌ Nodo no encontrado: {path} | FolderLabView.ts:1823 | sí |
| errors.viewNotOpen (+Marked) | Folder Lab no está abierto (±⚠️) | main.ts:928, NoteItemRenderer.ts:419 | no |
| errors.openSidePanel / loadView | ❌ No se pudo abrir el panel lateral / No se pudo cargar Folder Lab | main.ts:468,493 | no |
| errors.ignoredFoldersApplyFailed | ❌ No se pudo aplicar carpetas ignoradas… | main.ts:908 | no |
| errors.filtersUnavailable | 🔍 Filtros (no disponible) | HeaderComponent.ts:227 | no |
| errors.ai.notInitialized | ❌ Servicio de IA no inicializado | main.ts:1051 | no |
| notices.viewRefreshed / navigationUpdated / orderUpdated | Folder Lab actualizado / ✅ Navegación actualizada / Orden actualizado | main.ts:502,926, FolderLabController.ts:630 | no |
| notices.focusModeToggled (+enabled/disabled) | Modo enfoque activado/desactivado | FolderLabController.ts:817 | sí |
| notices.manualOrderToggled (+enabled/disabled) | Orden manual activado/desactivado | main.ts:660 | sí |
| notices.bookRootConfigured | ✅ Carpeta raíz configurada: {path} | main.ts:728 | sí |
| notices.navTypeChanged | Navegación cambiada a: {typeName} | main.ts:770 | sí |
| notices.presetApplied | Preset Jekyll aplicado | main.ts:796 | no |
| notices.noActiveNote (+Marked) | No hay nota activa (±❌) | main.ts:344, MemoryWidget.ts:744, ResourcesWidget.ts:268,499 | no |
| notices.contextTestResult | ✅ Contexto: {name} ({length} caracteres) | main.ts:367 | sí |

## 10. Comandos

| Clave | es | Ubicaciones |
|---|---|---|
| commands.openFolderLab | Abrir panel de Folder Lab | main.ts:322 |
| commands.refreshView | Refrescar vista | main.ts:328 |
| commands.toggleFocusMode | Alternar modo Focus | main.ts:334 |
| commands.testContextResolver | Probar ContextResolver (nota actual) | main.ts:340 |

## 11. Configuración (settings, ~70 claves)

Todas las `setName`/`setDesc`/`setPlaceholder`/`setButtonText`/títulos de `FolderLabSettingTab` (main.ts:648-1105): settings.title, manualOrder, showNumbers, numberingStyle (+opciones), bookRoot (+heading, placeholder "Ej: Libro/", botón "📁 Seleccionar", avisos interpolados), navigation.type (+opciones), properties.preset (+opciones; "Jekyll / Just the Docs" se conserva literal), propiedades title/parent/order/hasChildren/permalink, ignoredFolders (desc larga), refreshNavigation (+botón "🔄 Refrescar"), ai.* (proveedor, API Key, modelo recomendado/personalizado, temperatura, tokens, probar conexión con estados "⏳ Probando…"/"✅ Conectado"/"❌ Error", ayuda), info.* (3 textos informativos con nombres de archivo literales conservados). Placeholders técnicos ("title", "parent", "nav_order", "has_children", "permalink", "assets") NO se traducen.

## 12. Diálogos

| Clave | es | Ubicaciones |
|---|---|---|
| modal.selectRoot.title/description | Seleccionar carpeta raíz del libro / Elige la carpeta principal… | main.ts:71,73 |
| modal.wordCount.* (21) | Total palabras, Notas, Promedio por nota, Detalle por nota, Actualizar estadísticas(+aria), Actualizando…, error refresh, Establecer meta, 🎯 Meta de escritura, Cambiar meta, Meta de palabras, Palabras actuales, Cumplimiento, p. ej. 80000, aria, Guardar meta, 🏆 Más palabras, 📉 Menos palabras, fallback "Libro" | WordCountModal.ts (índices), FolderLabView.ts:969 |
| modal.polish.* (6) | Pulir fragmento, Original (solo lectura), Versión personal, Cancelar, Descartar, Guardar versión, "Pulir" | BoardPolishModal.ts, BoardDocumentView.ts:190,194 |

## 13. Focus, Board y Biblioteca

- focus.title.* / closeAria: Sin nota activa, Cerrar modo Focus (FocusTitle.ts:31,48).
- focus.workspace.*: Board, Cerrar, Biblioteca, Nota, Volver a la nota, Abrir Board (FocusWorkspace.ts:194-421).
- focus.sources.*: Nota/Apuntes/Snips/Tareas (LibraryBrowser.ts:600-615, MemoryWidget.ts:195-198, browser.ts:78-81).
- focus.dragdrop.dropFailed (FocusWidgetsUtils.ts:670).
- board.modes/explore/context/card/group/connect/architecture/document (~60 claves): Board.ts, BoardArchitectureView.ts, BoardDocumentView.ts — títulos, invitaciones, placeholders, aria-labels, badges ("Desactivada"), plurales del panel Contexto (board.context.counts.*), "Ver más/menos", "Conectar", etc.
- library.* (~18): pestañas WIDGETS/ASISTENTE/RECETAS, columnas, estados vacíos, FUENTES/DOMINIOS/CAPACIDADES (LibraryBrowser.ts y browser.ts, claves compartidas).

## 14. Widgets

- widgets.registered.*: labels/descriptions de los4 widgets registrados (main.ts:205-286).
- widgets.managerDefaultName.*: Asistente/Apuntes (WidgetManager.ts:141-142,391-392).
- widgets.declarative.*: empty, notices (cleared con {label}, movedTo/addedTo), acciones (activate/deactivate/selectCandidate).
- widgets.common.*: Sesión/Hoy, Expandir/Contraer, "Error: {message}".
- widgets.activeNote/memory/notesWidget/resourcesWidget/controls: placeholders, estados vacíos, notices, aria-labels (ActiveNote/Memory/Notes/ResourcesWidget, WidgetControlsRenderer.ts:221).
- widgets.defs.*: labels/descriptions/emptyState/placeholder de widget-definitions.json (Snips, Colecciones, Restricciones, Candidatos, Tareas).

## 15. Recursos y IA

- resources.* (~30): modal AddResourceModal (campos, placeholders, validaciones, botones), notices de ResourcesWidget, filePicker, nombre por defecto "recurso".
- ai.browser.title/empty ("Trabajo"; FUENTES/DOMINIOS/CAPACIDADES comparten library.section.*).
- ai.connection.*: mensajes de AIService.testConnection visibles en Notices.
- domains.*: label/description de los3 dominios y9 capacidades de src/ai/prompts/domains/*.json (visibles en los navegadores de capacidades).

## Excluidos (decididos)

1. **Diagnóstico interno** (no llega a UI): DeclarativeRuntime.ts (21 validaciones), throws de NavigationService.ts:130,144, PropertyOrderService.ts:47, BoardRepository.ts:173, NoteRepository.ts:87, ResourceService.ts (throws y validateResource sin llamadores), todo `console.*`.
2. **Código muerto** (sin llamadores; no migrar, candidato a eliminar): StatsService.getStatsText/getDetailedStatsText, WordCountService.getSummaryText/getDetailedText, FilterService.getFilterLabel, ExportService.showExportMenu/exportSelectedNotes/exportAllSubfolderNotes.
3. **No traducibles**: marcas (Folder Lab, OpenAI, Google Gemini, Anthropic Claude, Jekyll / Just the Docs, Snips, Board como nombre de vista), "API Key", placeholders técnicos ("title", "nav_order", "assets", "https://..."), glifos (×, +, ·, ✓, WEB, ARCHIVO), ids de estado, formatos persistidos.
4. **Datos de usuario**: nombres de notas/archivos/rutas en interpolaciones (parámetros, no traducción), `instance.name` persistido, contenido de tarjetas.
5. **Fuera de alcance fase 1**: material de prompts LLM (templates/*.md, instrucciones PromptBuilder/providers), manifest.json de Obsidian (el ecosistema no localiza manifests de forma estándar — decisión de producto), README, `src/main.js` (artefacto de build).
6. **Casos con decisión pendiente** (ver informe): "Revisar" duplicado (review/thumb-down), emoji dentro de cadenas, texto de documento exportado, plural `${label} vaciadas`.

---

## Addendum de cierre (etapa 8)

La migración por etapas está **completa**. Barrido final de `src/**/*.ts`:

- **0 cadenas visibles en español sin localizar** fuera de código muerto (verificado por script de posiciones UI: Notice/setTitle/text:/placeholder/aria-label/etc.).
- Literales restantes clasificados: **código muerto confirmado** (`ExportService.showExportMenu/exportSelectedNotes/exportAllSubfolderNotes`, `StatsService.getStatsText/getDetailedStatsText`, `WordCountService.getSummaryText/getDetailedText` — sin llamadores, no migrados ni reactivados); **diagnóstico interno** (`console.*`, throws de `DeclarativeRuntime`, `NavigationService`, `PropertyOrderService`, `BoardRepository`, `NoteRepository`, `ResourceService`); **valores técnicos** (placeholders `title/parent/nav_order/...`, glifos, `WEB`/`ARCHIVO`, `https://...`, marcas); **contenido de usuario** (nombres de notas/rutas, `instance.name` persistido, `recurso` como nombre de archivo); **prompts de IA** (`src/ai/prompts/**`, instrucciones de proveedores); **identificadores** (`_empty`, `_no-status`, ids de estado/widget/comando).
- Últimas migraciones de cierre: componentes secundarios (`NoteItemComponent`, `NoteItemRenderer`, `NoteListComponent`, `NoteAreaComponent`), título del nodo raíz de `PropertyNavigationProvider` y corrección de un `string | undefined` en el tooltip de estado.
- Catálogos: 478/478 hojas en paridad, tipos e interpolaciones compatibles, plurales one/other completos. 33 valores compartidos entre claves son alias semánticos intencionados (mismo texto, contextos distintos).
- Limitación documentada en `I18nService.tn()`: soporte de pluralización es/en (one/other); idiomas con categorías few/many requieren ampliar el contrato de claves antes de declarar soporte.
