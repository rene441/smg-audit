# SMG Accessibility Audit

Proyecto independiente para ejecutar exactamente el flujo actual de auditoria de accesibilidad con Playwright + axe-core + integracion WAVE, sin depender del MCP server.

## Incluye

- Auditoria principal: `tools/accessibility-cli/accessibility-audit-playwright.cjs`
- Lectura de reporte: `scripts/read-accessibility-report.cjs`
- Reparacion desde reporte: `scripts/repair-accessibility-from-report.cjs`

## Instalacion

```bash
npm install
```

Si solo quieres usar el validador publicado en npm, requiere Node 18+:

```bash
npm install -g @rene__25/smg-accessibility-audit
npx playwright install chromium
smg-accessibility-audit --url "https://tutienda.myshopify.com"
```

La instalacion global se hace una sola vez por maquina, no en cada proyecto.

Si Playwright no encuentra el navegador, corre una sola vez:

```bash
npx playwright install chromium
```

Si lo instalaste global, puedes correr los comandos desde cualquier carpeta:

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com"
smg-accessibility-audit-and-repair --url "https://tutienda.myshopify.com" --project
smg-accessibility-report
smg-accessibility-repair --project
```

O sin instalacion global:

```bash
npx @rene__25/smg-accessibility-audit --url "https://tutienda.myshopify.com"
```

## Comandos

Estos comandos `npm run` aplican solo si estas parado dentro de este repo:

```bash
npm run accessibility-audit -- --url "https://tutienda.myshopify.com"
npm run accessibility-audit-and-repair -- --url "https://tutienda.myshopify.com" --project
npm run accessibility-audit-complete -- --url "https://tutienda.myshopify.com"
npm run accessibility-audit-complete-html -- --url "https://tutienda.myshopify.com"
npm run accessibility-report-read
npm run accessibility-repair -- --project
```

- `accessibility-audit`: corre la auditoria base.
- `accessibility-audit-and-repair`: audita y aplica reparaciones automaticas en la carpeta actual. Por defecto solo deja el HTML de slides como archivo nuevo.
- `accessibility-audit-complete`: auditoria mas completa, incluyendo WAVE si esta disponible.
- `accessibility-audit-complete-html`: igual que el completo, pero genera un HTML tipo diapositivas con capturas de pantalla para hallazgos de contraste.
- `accessibility-report-read`: lee y resume el reporte generado.
- `accessibility-repair`: aplica reparaciones desde un reporte existente en la carpeta actual.

## Salidas

Por defecto `accessibility-audit-and-repair` usa una carpeta temporal para no ensuciar el proyecto y solo deja `accessibility-contrast-slides.html` en la raiz. Si quieres conservar todos los reportes, puedes usar `--output-dir` o `SMG_ACCESSIBILITY_OUTPUT_DIR`.

Archivos generados:

- `accesibilidad_report.txt`
- `color-contrast-report.txt`
- `accessibility-contrast-slides.html`: HTML navegable tipo slides con capturas del problema y zoom del area afectada.

Para generar ese HTML usa:

```bash
npm run accessibility-audit-complete-html -- --url "https://tutienda.myshopify.com"
```

## Un solo comando: auditar y reparar

```bash
npm run accessibility-audit-and-repair -- --url "https://tutienda.myshopify.com" --project
```

Si ejecutas el comando desde la raiz del theme, `--project` usa el directorio actual. Tambien puedes omitir `--project` y se usa esa misma ruta. Si necesitas otro proyecto, entonces si puedes pasar una ruta explicita.

## Nota

Esta migracion conserva el comportamiento del slice de accesibilidad. El validador general de QA sigue estando fuera de este proyecto.