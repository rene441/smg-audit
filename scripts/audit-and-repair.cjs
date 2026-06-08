#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CURRENT_PROJECT_PATH = process.cwd();
const CONTRAST_SLIDES_FILE_NAME = 'accessibility-contrast-slides.html';

function resolveProjectPath(projectArg) {
  if (typeof projectArg !== 'string' || projectArg.trim() === '') {
    return path.resolve(CURRENT_PROJECT_PATH);
  }

  return path.resolve(projectArg);
}

const argv = yargs(hideBin(process.argv))
  .option('url', {
    alias: 'u',
    describe: 'URL a auditar',
    type: 'string',
    demandOption: true,
  })
  .option('project', {
    alias: 'p',
    describe: 'Ruta raiz del proyecto Shopify a reparar. Si se omite el valor, usa el directorio actual.',
    type: 'string',
    default: CURRENT_PROJECT_PATH,
  })
  .option('output-dir', {
    describe: 'Carpeta donde se guardan los reportes generados por la auditoria',
    type: 'string',
  })
  .option('report', {
    alias: 'r',
    describe: 'Ruta explicita a accesibilidad_report.txt; sobreescribe output-dir',
    type: 'string',
  })
  .help()
  .argv;

const scriptRoot = __dirname;
const auditScriptPath = path.join(scriptRoot, '..', 'tools', 'accessibility-cli', 'accessibility-audit-playwright.cjs');
const repairScriptPath = path.join(scriptRoot, 'repair-accessibility-from-report.cjs');
const projectPath = resolveProjectPath(argv.project);
const usingExplicitOutputDir = typeof argv.outputDir === 'string' && argv.outputDir.trim() !== '';
const tempOutputDir = usingExplicitOutputDir
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), 'smg-accessibility-audit-'));
const outputDir = usingExplicitOutputDir
  ? path.resolve(argv.outputDir)
  : tempOutputDir;
const reportPath = argv.report
  ? path.resolve(argv.report)
  : path.join(outputDir, 'accesibilidad_report.txt');
const contrastSlidesPath = path.join(outputDir, CONTRAST_SLIDES_FILE_NAME);
const projectSlidesPath = path.join(projectPath, CONTRAST_SLIDES_FILE_NAME);

const forwardedAuditArgs = process.argv.slice(2).filter((arg, index, originalArgs) => {
  const previousArg = index > 0 ? originalArgs[index - 1] : '';
  const isManagedValue = (
    (previousArg === '--project'
      || previousArg === '-p'
      || previousArg === '--report'
      || previousArg === '-r'
      || previousArg === '--output-dir')
    && !arg.startsWith('-')
  );
  const isManagedInline = arg.startsWith('--project=')
    || arg.startsWith('--report=')
    || arg.startsWith('--output-dir=');

  if (isManagedValue || isManagedInline) {
    return false;
  }

  return !['--project', '-p', '--report', '-r', '--output-dir'].includes(arg);
});

function runNodeScript(scriptPath, args, label) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SMG_ACCESSIBILITY_OUTPUT_DIR: outputDir,
    },
  });

  if (result.error) {
    throw new Error(`Error ejecutando ${label}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const commandError = new Error(`Error ejecutando ${label}.`);
    commandError.exitCode = result.status;
    throw commandError;
  }
}

function collectReportPaths(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const collected = [];

  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'accesibilidad_report.txt') {
        collected.push(fullPath);
      }
    }
  };

  walk(rootDir);

  // Root report first, then nested pages for deterministic output.
  collected.sort((left, right) => {
    const leftDepth = left.split(path.sep).length;
    const rightDepth = right.split(path.sep).length;

    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return left.localeCompare(right);
  });

  return collected;
}

function persistContrastSlides() {
  if (!fs.existsSync(contrastSlidesPath)) {
    return false;
  }

  fs.copyFileSync(contrastSlidesPath, projectSlidesPath);
  return true;
}

function cleanupTemporaryOutputDir() {
  if (!tempOutputDir || !fs.existsSync(tempOutputDir)) {
    return;
  }

  fs.rmSync(tempOutputDir, { recursive: true, force: true });
}

try {
  runNodeScript(auditScriptPath, [...forwardedAuditArgs, '--output-dir', outputDir], 'auditoria');
  const reportPaths = argv.report
    ? [reportPath]
    : collectReportPaths(outputDir);

  if (reportPaths.length === 0) {
    throw new Error(`No se encontro ningun accesibilidad_report.txt en ${outputDir}`);
  }

  for (const currentReportPath of reportPaths) {
    console.log(`[REPAIR] Procesando reporte: ${currentReportPath}`);
    runNodeScript(repairScriptPath, ['--project', projectPath, '--report', currentReportPath], 'reparacion');
  }

  const slidesWerePersisted = !usingExplicitOutputDir && persistContrastSlides();

  console.log('========================');
  console.log('  Auditoria + Reparacion completadas');
  console.log('========================');
  console.log(`Proyecto reparado: ${projectPath}`);
  if (reportPaths.length === 1) {
    console.log(`Reporte usado: ${reportPaths[0]}`);
  } else {
    console.log(`Reportes usados: ${reportPaths.length}`);
  }
  if (slidesWerePersisted) {
    console.log(`Slides contraste: ${projectSlidesPath}`);
  }
} catch (error) {
  if (error && error.message) {
    console.error(error.message);
  }
  process.exit(typeof error.exitCode === 'number' ? error.exitCode : 1);
} finally {
  cleanupTemporaryOutputDir();
}