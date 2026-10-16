// ============================================================
// ESLint (configuración plana, ESLint 10)
//
// Reconstrucción de la configuración usada en la auditoría del
// 15/10/2026 (docs/audits/lint-report.txt): la configuración
// original nunca se commiteó, pero el bundle `recommended` de
// eslint-plugin-obsidianmd reproduce exactamente el conjunto de
// reglas observado en ese informe (obsidianmd/no-static-styles-assignment,
// obsidianmd/no-unsupported-api, obsidianmd/prefer-create-el,
// obsidianmd/no-plugin-as-component y las type-checked de
// typescript-eslint).
//
// Uso documentado por el plugin:
// https://www.npmjs.com/package/eslint-plugin-obsidianmd
// ============================================================

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,

  {
    // Artefacto de build (gitignored): bundle generado por
    // esbuild, no fuente. El informe histórico no lo incluía.
    ignores: ["src/main.js", "docs/**"]
  },

  {
    languageOptions: {
      parserOptions: {
        // Las reglas type-checked del bundle necesitan acceso
        // al proyecto TS. eslint.config.* no está en el
        // tsconfig: se permite como proyecto por defecto.
        projectService: {
          allowDefaultProject: ["eslint.config.*"]
        }
      }
    }
  }
]);
