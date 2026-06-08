# SMG Accessibility Audit

Auditoría de accesibilidad con Playwright + axe-core + integración WAVE.

## Instalación

```bash
npm install
npx playwright install chromium
```

O como paquete global (una sola vez por máquina):

```bash
npm install -g smg-accessibility-audit
npx playwright install chromium
```

---

## Comandos rápidos

Dentro de este repo:

```bash
npm run accessibility-audit-complete -- --url "https://tutienda.myshopify.com"
npm run accessibility-audit-complete-html -- --url "https://tutienda.myshopify.com"
npm run accessibility-audit-and-repair -- --url "https://tutienda.myshopify.com" --project
npm run accessibility-report-read
npm run accessibility-repair -- --project
```

Como paquete global:

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com"
smg-accessibility-audit-and-repair --url "https://tutienda.myshopify.com" --project
smg-accessibility-report
smg-accessibility-repair --project
```

Sin instalación global:

```bash
npx smg-accessibility-audit --url "https://tutienda.myshopify.com"
```

---

## Opciones principales

| Flag | Descripción | Default |
|------|-------------|---------|
| `--url` | URL a auditar (requerida) | — |
| `--mode` | `full` (todas las reglas) o `critical` (image-alt, link-name, color-contrast) | `full` |
| `--html` | Genera también un reporte HTML | `false` |
| `--headful` | Muestra el navegador en pantalla | `false` |
| `--output-dir` | Carpeta donde se guardan los reportes | `.smg-accessibility-audit/` |
| `--site` | Audita todas las páginas internas del sitio | `false` |
| `--asana` | Crea tickets en Asana al finalizar (tarea padre + subtarea por página) | `false` |
| `--asana-token` | Personal Access Token de Asana (o `ASANA_TOKEN` / `ASANA_PAT`) | — |
| `--asana-project-gid` | GID del proyecto Asana destino si no se detecta automáticamente | — |

---

## Auditoría de sitio completo (`--site`)

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com" --site
```

Después de auditar la URL inicial, el auditor descubre todos los links internos y pregunta antes de auditar cada página:

```
[SITE] (1/12) https://tutienda.myshopify.com/about
  [y] Auditar  [n] Omitir  [a] Auditar todas las siguientes automaticamente
  >
```

| Respuesta | Efecto |
|-----------|--------|
| `y` | Audita esa página y pregunta por la siguiente |
| `n` | Salta esa página y pregunta por la siguiente |
| `a` | Audita esa página y todas las restantes sin preguntar más |

Cada página auditada guarda sus reportes en una subcarpeta nombrada con su path:

```
.smg-accessibility-audit/
  accesibilidad_report.txt          ← URL inicial
  accessibility-contrast-slides.html
  about/
    accesibilidad_report.txt
    accessibility-contrast-slides.html
  collections-all/
    accesibilidad_report.txt
    accessibility-contrast-slides.html
```

---

## Tickets en Asana (`--asana`)

Agrega `--asana` junto con `--site` para crear automáticamente los tickets en Asana al terminar:

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com" --site --asana
```

Primero guarda el token una sola vez:

```bash
smg-accessibility-audit --save-asana-token tu_personal_access_token
```

Eso lo guarda en `~/.config/smg/asana.env`. A partir de ahí solo necesitas `--asana`:

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com" --site --asana
```

**Qué crea en Asana:**

- **Tarea padre** en el proyecto que corresponde al dominio: `[ADA Audit] dominio.com — 2026-06-05`
- **Subtarea por página auditada**: `[ADA] /about — CON ERRORES (7 elementos)`
  - Descripción con lista de reglas incumplidas y los elementos afectados (selector, clase, HTML)
  - El archivo `accessibility-contrast-slides.html` adjunto con las capturas visuales

El proyecto de Asana se detecta automáticamente buscando por nombre de dominio en el workspace de SMG. Si no se encuentra o quieres especificarlo manualmente:

```bash
smg-accessibility-audit --url "https://tutienda.myshopify.com" --site --asana --asana-project-gid 1234567890123456
```

---

## WAVE

`--wave auto` viene por defecto. Orden de prioridad automática:

1. WAVE extension instalada localmente en Edge o Chrome
2. WAVE API si existe `WAVE_API_KEY`
3. Reporte público de WebAIM (solo páginas públicas)

Para forzar una fuente específica:

```bash
--wave extension
--wave api
--wave off
```

Para páginas privadas o con login:

```bash
smg-accessibility-audit --url "https://preview.myshopify.com" \
  --wave extension \
  --page-visibility private \
  --wave-login-wait-ms 15000
```

Opciones WAVE adicionales:

| Flag | Descripción | Default |
|------|-------------|---------|
| `--wave-api-key` | API key de WAVE (o variable `WAVE_API_KEY`) | — |
| `--page-visibility` | `auto`, `public` o `private` | `auto` |
| `--wave-login-wait-ms` | Tiempo extra para login manual antes de activar WAVE | `0` |

---

## Salidas

| Archivo | Descripción |
|---------|-------------|
| `accesibilidad_report.txt` | Reporte completo con todos los hallazgos |
| `accessibility-contrast-slides.html` | Slides navegables con capturas de cada error de contraste |
| `accessibility-report.html` | Reporte axe-core en HTML (solo con `--html`) |

---

## Auditar y reparar en un solo paso

```bash
smg-accessibility-audit-and-repair --url "https://tutienda.myshopify.com" --project
```

Ejecuta la auditoría y aplica autofix sobre el proyecto. Si corres el comando desde la raíz del theme, `--project` usa ese directorio.

Con `--site`, aplica autofix usando todos los `accesibilidad_report.txt` generados (raíz + subcarpetas por página).

Reglas con autofix disponible:
- `image-alt`
- `link-name` (casos seguros)

Requieren corrección manual:
- `color-contrast`
- Hallazgos WAVE sin mapping determinístico
