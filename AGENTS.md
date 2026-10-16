# Instrucciones permanentes — Folder Lab

Política obligatoria de desarrollo para contribuidores humanos y agentes
(OpenCode u otros) que trabajen en este repositorio.

## Comprobaciones obligatorias

Antes de entregar cualquier cambio que afecte a `src/`, `tests/` o la
configuración, ejecutar y dejar en verde:

```bash
npm run lint          # ESLint sobre src/ (eslint.config.mjs)
npx tsc -noEmit -skipLibCheck
npm test
npm run build
```

Si una comprobación no puede ejecutarse, **detenerse y comunicarlo**: nunca
presentar un lint no ejecutado como superado.

## Política ESLint (eslint.config.mjs)

1. **No introducir errores ni warnings ESLint nuevos y evitables.**
   Antes de entregar, comparar `npm run lint` con la línea base documentada
   más abajo: el número de errores debe ser 0 y los warnings no deben crecer
   sin justificación explícita en el informe de entrega.
2. **No desactivar reglas ni ocultar infracciones** para conseguir un
   resultado limpio: prohibidos `eslint-disable`, `eslint-disable-next-line`
   (salvo justificación técnica documentada caso a caso), cambios de
   severidad en `eslint.config.mjs` y supresiones equivalentes. Si una regla
   produce un falso positivo, conservar el código correcto y aplicar la
   solución más localizada y justificable (p. ej. anotación de variable en
   lugar de aserción para `querySelector`/`closest`).
3. **Distinguir la deuda preexistente de las infracciones nuevas.** La
   línea base conocida (2026-10-16, tras la limpieza de octubre) son
   **0 errores y 28 warnings**. Ver detalle en «Línea base de warnings».
   Corregir primero cualquier infracción introducida por el cambio en curso;
   la deuda preexistente no crece y se aborda solo en tareas dedicadas.
4. **No ampliar la deuda**: si un archivo con warnings preexistentes se
   modifica, no añadir nuevos del mismo tipo sin motivo técnico; aprovechar
   para reducirlos cuando sea seguro y puntual.

### Línea base de warnings (28, deuda documentada — NO excepciones globales)

Estos warnings son conocidos y tolerados **hasta que se resuelva el caso
concreto**; no autorizan a introducir otros iguales en código nuevo:

| Cantidad | Regla | Motivo de la excepción puntual |
|---|---|---|
| 10 | `@typescript-eslint/no-explicit-any` | Contratos de transporte abiertos deliberados (`WidgetRecord`, `Context`, items de widgets) con justificación en su propio código. |
| 7 | `@typescript-eslint/no-deprecated` | APIs anteriores a `minAppVersion` (1.4.4): `display`, `activeLeaf`, `setWarning`. Sustituirlas exige elevar `minAppVersion` (p. ej. `getSettingDefinitions`/@since 1.13.0): decisión de producto, no estética. |
| 4 | `no-restricted-globals` (`localStorage`) | Espejo de emergencia `localMirror`: diseño deliberado vault-agnóstico. |
| 3 | `obsidianmd/no-global-this` | `crypto`/`moment` vía `globalThis` por portabilidad Node (tests) + Obsidian. |
| 2 | `obsidianmd/commands/no-plugin-id-in-command-id` | Cambiar los ids rompería atajos persistidos de usuarios. |
| 1 | `obsidianmd/settings-tab/prefer-setting-definitions` | Requiere API @since 1.13.0 > `minAppVersion`. |
| 1 | `obsidianmd/prefer-file-manager-trash-file` | `managedDelete` controla semántica de borrado propia; `trashFile` la cambiaría. |

Evidencia histórica del lint original: `docs/audits/lint-report.txt`
(informe del 15/10/2026, generado con la configuración previa no commiteada).

## Compatibilidad con Obsidian

- Respetar `minAppVersion` de `manifest.json` (**1.4.4**): no usar APIs
  posteriores sin acordar antes elevar la versión mínima.
- Preferir helpers del SDK (`createDiv`, `createSpan`, `createEl`,
  `instanceOf(HTMLElement)`, `setIcon`) según las reglas `obsidianmd/*`.
- Idioma de la UI vía `i18n` (`src/i18n/locales/es.json` y `en.json`
  **en paridad obligatoria**; los tests i18n fallan si se rompe).

## Datos y persistencia

- No introducir mecanismos de almacenamiento paralelos: reutilizar
  `WidgetController.storage`, `DraftStore`, `LocalMirror` y los repositorios
  existentes.
- Los identificadores persistidos (ids de instancia, ids de comando, campos
  de definiciones) son contrato: no renombrarlos sin migración.

## Tests

- Ejecutar `npm test` completo (cadena de suites `node --test`).
- Si un test de fuente (i18nStage*, integridad) verifica un literal que el
  cambio altera legítimamente, **actualizar la aserción para conservar su
  contrato**, nunca eliminarla.
- Los stubs de DOM de tests (`FakeEl`) deben reflejar los helpers reales de
  Obsidian (`createEl`, `createDiv`, `createSpan`, …).

## Entrega

- Implementar, verificar y corregir de forma autónoma antes de entregar.
- Commits pequeños y aislados: no mezclar funcionalidad y limpieza de estilo
  en el mismo commit cuando puedan separarse.
- Nunca incluir artefactos de build (`src/main.js` está gitignored) ni
  dependencias `node_modules`.
- No hacer `reset`/`checkout`/`restore` sobre cambios del usuario sin
  instrucción explícita.
