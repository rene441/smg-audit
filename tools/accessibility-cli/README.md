# Auditoría de Accesibilidad

Este módulo corre `axe-core` y, si WAVE está disponible, la agrega en el mismo comando.

## Comando principal

Desde `mcp-server`:

```bash
npm run accessibility-audit-complete -- --url "https://tutienda.myshopify.com"
```

Genera `accesibilidad_report.txt`.

Por defecto corre solo el escenario base por viewport para reducir tiempo.
Si quieres volver a incluir estados interactivos, usa por ejemplo `--max-interactive-scenarios 3`.

Si quieres HTML también:

```bash
npm run accessibility-audit-complete-html -- --url "https://tutienda.myshopify.com"
```

## WAVE

`--wave auto` ya viene por defecto.

Orden de prioridad:
- WAVE extension instalada localmente en Edge o Chrome.
- WAVE API si existe `WAVE_API_KEY`.
- Si no encuentra ninguna, el reporte lo indica en la sección `Integracion WAVE`.

Si quieres forzar comportamiento:
- `--wave extension`
- `--wave api`
- `--wave off`

Para páginas privadas puede servir:

```powershell
npm run accessibility-audit-complete -- --url "https://preview-o-privada.com" --wave extension --page-visibility private --wave-login-wait-ms 15000
```

## Otros comandos

Leer reporte completo o una regla:

```powershell
npm run accessibility-report-read
npm run accessibility-report-read -- --color-contrast
```

Reparación automática desde otro proyecto:

```powershell
npm --prefix "C:/Users/Rene/Desktop/solomediagroup/smg-shopify-standards/mcp-server" run accessibility-repair -- --project "C:/ruta/de/tu/proyecto"
```

Autofix actual:
- `image-alt`
- `link-name` en casos seguros

Manual por ahora:
- `color-contrast`
- hallazgos WAVE sin mapping determinístico
