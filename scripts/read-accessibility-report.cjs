#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function resolveDefaultReportPath() {
  const reportDir = process.env.SMG_ACCESSIBILITY_OUTPUT_DIR
    ? path.resolve(process.env.SMG_ACCESSIBILITY_OUTPUT_DIR)
    : path.join(process.cwd(), '.smg-accessibility-audit');

  return path.join(reportDir, 'accesibilidad_report.txt');
}

function getRuleIds(reportContent) {
  return [...new Set(
    reportContent
      .split('\n')
      .map((line) => line.match(/^Regla:\s*(.+)$/))
      .filter(Boolean)
      .map((match) => match[1].trim()),
  )];
}

function extractRuleSection(reportContent, ruleId) {
  if (!ruleId) {
    return reportContent;
  }

  const sections = reportContent
    .split('------------------------')
    .map((section) => section.trim())
    .filter(Boolean);

  const matchingSection = sections.find((section) => section.startsWith(`Regla: ${ruleId}`));

  if (!matchingSection) {
    return '';
  }

  const header = reportContent.split('------------------------')[0].trimEnd();

  return [
    header,
    '------------------------',
    matchingSection,
  ].join('\n');
}

function parseCliArgs(args, availableRuleIds) {
  const selectedRuleIds = [];
  let outputPath = null;
  let reportPath = null;
  let reportDir = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--report' || arg === '-r') {
      reportPath = args[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length);
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = args[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--report-dir=')) {
      reportDir = arg.slice('--report-dir='.length);
      continue;
    }

    if (arg === '--output' || arg === '-o') {
      outputPath = args[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--report-dir' || arg.startsWith('--report-dir=')) {
      continue;
    }

    if (arg === '--report' || arg === '-r' || arg.startsWith('--report=')) {
      continue;
    }

    if (arg.startsWith('--')) {
      selectedRuleIds.push(arg.slice(2));
      continue;
    }
  }

  if (selectedRuleIds.length > 1) {
    console.error('Usa solo un flag de regla por ejecucion.');
    console.error(`Reglas disponibles: ${availableRuleIds.join(', ')}`);
    process.exit(1);
  }

  const selectedRuleId = selectedRuleIds[0] || null;

  if (selectedRuleId && !availableRuleIds.includes(selectedRuleId)) {
    console.error(`La regla solicitada no existe en el reporte actual: ${selectedRuleId}`);
    console.error(`Reglas disponibles: ${availableRuleIds.join(', ')}`);
    process.exit(1);
  }

  if ((args.includes('--output') || args.includes('-o')) && !outputPath) {
    console.error('Debes indicar una ruta despues de --output.');
    process.exit(1);
  }

  return {
    outputPath,
    reportDir,
    reportPath,
    selectedRuleId,
  };
}

const initialArgs = parseCliArgs(process.argv.slice(2), []);
const reportPath = initialArgs.reportPath
  ? path.resolve(initialArgs.reportPath)
  : path.join(path.resolve(initialArgs.reportDir || process.env.SMG_ACCESSIBILITY_OUTPUT_DIR || path.join(process.cwd(), '.smg-accessibility-audit')), 'accesibilidad_report.txt');

if (!fs.existsSync(reportPath)) {
  console.error('No se encontro el reporte de accesibilidad en:');
  console.error(reportPath);
  process.exit(1);
}

const content = fs.readFileSync(reportPath, 'utf8');

if (!content || !content.trim()) {
  console.error('El archivo de reporte existe pero esta vacio:');
  console.error(reportPath);
  process.exit(1);
}

const availableRuleIds = getRuleIds(content);
const { outputPath, selectedRuleId } = parseCliArgs(process.argv.slice(2), availableRuleIds);
const filteredContent = extractRuleSection(content, selectedRuleId);

if (selectedRuleId && !filteredContent) {
  console.error(`No se pudo extraer la seccion para la regla: ${selectedRuleId}`);
  process.exit(1);
}

if (outputPath) {
  const absoluteOutputPath = path.resolve(outputPath);
  fs.writeFileSync(absoluteOutputPath, filteredContent, 'utf8');
  console.log(`Archivo generado: ${absoluteOutputPath}`);
  process.exit(0);
}

console.log(`Report path: ${reportPath}`);
console.log('');
console.log(filteredContent);