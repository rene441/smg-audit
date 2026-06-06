#!/usr/bin/env node

// accessibility-audit-playwright.cjs
// Auditoria de accesibilidad critica usando Playwright + @axe-core/playwright

const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { createHtmlReport } = require('axe-html-reporter');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CRITICAL_RULES = ['image-alt', 'link-name', 'color-contrast'];
const AUDIT_MODES = ['critical', 'full'];
const WAVE_SOURCES = ['off', 'auto', 'api', 'extension'];
const PAGE_VISIBILITY_OPTIONS = ['auto', 'public', 'private'];
const AUTO_FIXABLE_RULES = new Set(['image-alt', 'link-name']);
const WAVE_DETAILED_CATEGORIES = new Set(['error', 'contrast']);
const REPORT_HTML_SNIPPET_LIMIT = 160;
const REPORT_PRIORITY_RULES = ['color-contrast'];
const CONTRAST_SLIDES_FILE_NAME = 'accessibility-contrast-slides.html';
const CONTRAST_SCREENSHOT_TYPE = 'jpeg';
const CONTRAST_SCREENSHOT_QUALITY = 72;
const CONTRAST_ZOOM_SCREENSHOT_QUALITY = 82;
const CONTRAST_HIGHLIGHT_COLOR = '#ff5a36';
const WAVE_API_ENDPOINT = 'https://wave.webaim.org/api/request';
const WAVE_REPORT_URL = 'https://wave.webaim.org/report';
const WAVE_API_VIEWPORT_WIDTH = 1440;
const WAVE_EXTENSION_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+U' : 'Control+Shift+U';
const WAVE_SUMMARY_CATEGORY_IDS = {
  error: 'error',
  contrastnum: 'contrast',
  alert: 'alert',
  feature: 'feature',
  structure: 'structure',
  aria: 'aria',
};
const WAVE_PROTECTED_URL_PATTERNS = [
  /\/password\b/i,
  /\/login\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/auth\b/i,
  /\/challenge\b/i,
  /\/account(?:\/|%2F)login\b/i,
];
const WAVE_PROTECTED_BODY_PATTERNS = [
  /type=["']password["']/i,
  /storefront password/i,
  /enter using password/i,
  /customer[_-]login/i,
  /password page/i,
  /captcha/i,
  /verify you are human/i,
];
const WAVE_BROWSER_INSTALLATIONS = {
  win32: [
    {
      browserChannel: 'msedge',
      browserLabel: 'Edge',
      extensionId: 'khapceneeednkiopkkbgkibbdoajpkoj',
      userDataRoot: process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data')
        : '',
    },
    {
      browserChannel: 'chrome',
      browserLabel: 'Chrome',
      extensionId: 'jbbplnpkjmmeebjpijfedlgcdilocofh',
      userDataRoot: process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
        : '',
    },
  ],
  darwin: [
    {
      browserChannel: 'msedge',
      browserLabel: 'Edge',
      extensionId: 'khapceneeednkiopkkbgkibbdoajpkoj',
      userDataRoot: process.env.HOME
        ? path.join(process.env.HOME, 'Library', 'Application Support', 'Microsoft Edge')
        : '',
    },
    {
      browserChannel: 'chrome',
      browserLabel: 'Chrome',
      extensionId: 'jbbplnpkjmmeebjpijfedlgcdilocofh',
      userDataRoot: process.env.HOME
        ? path.join(process.env.HOME, 'Library', 'Application Support', 'Google', 'Chrome')
        : '',
    },
  ],
};
const AUDIT_VIEWPORTS = [
  {
    id: 'desktop',
    label: 'desktop',
    width: 1440,
    height: 900,
  },
  {
    id: 'mobile',
    label: 'mobile',
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
  },
];
const DEFAULT_INTERACTION_DISCOVERY_LIMIT = 8;
const DEFAULT_MAX_INTERACTIVE_SCENARIOS = 0;
const DEFAULT_PREPARE_PAGE_DELAY_MS = 1500;
const DEFAULT_SCROLL_STEP_PX = 700;
const DEFAULT_SCROLL_INTERVAL_MS = 120;
const DEFAULT_INTERACTION_SETTLE_DELAY_MS = 700;
const DEFAULT_SCENARIO_TIMEOUT_MS = 45000;
const DEFAULT_MODAL_DISMISS_TIMEOUT_MS = 4500;
const SCREENSHOT_MODAL_DISMISS_TIMEOUT_MS = 2000;
const VISIBILITY_CHECK_TIMEOUT_MS = 30000;
const WAVE_UI_DISCOVERY_DELAY_MS = 1200;

const argv = yargs(hideBin(process.argv))
  .option('url', {
    alias: 'u',
    describe: 'URL a auditar',
    type: 'string',
  })
  .option('html', {
    describe: 'Genera tambien un reporte HTML (se sobrescribe en cada ejecucion)',
    type: 'boolean',
    default: false,
  })
  .option('output-dir', {
    describe: 'Carpeta donde se guardan accesibilidad_report.txt y archivos derivados',
    type: 'string',
  })
  .option('headful', {
    describe: 'Mostrar navegador (no headless)',
    type: 'boolean',
    default: false,
  })
  .option('mode', {
    alias: 'm',
    describe: 'Modo de auditoria: critical (reglas clave) o full (todas las reglas de axe-core)',
    type: 'string',
    choices: AUDIT_MODES,
    default: 'full',
  })
  .option('wave', {
    describe: 'Integracion WAVE: off, auto, api o extension',
    type: 'string',
    choices: WAVE_SOURCES,
    default: 'auto',
  })
  .option('page-visibility', {
    describe: 'Visibilidad esperada de la pagina: auto, public o private',
    type: 'string',
    choices: PAGE_VISIBILITY_OPTIONS,
    default: 'auto',
  })
  .option('wave-api-key', {
    describe: 'API key de WAVE (tambien puede venir por WAVE_API_KEY)',
    type: 'string',
  })
  .option('wave-api-report-type', {
    describe: 'Nivel de detalle de WAVE API (1 a 4)',
    type: 'number',
    choices: [1, 2, 3, 4],
    default: 4,
  })
  .option('wave-api-timeout-ms', {
    describe: 'Timeout de WAVE API en milisegundos',
    type: 'number',
    default: 120000,
  })
  .option('wave-extension-dir', {
    describe: 'Ruta a la extension WAVE descomprimida para cargarla en Chromium',
    type: 'string',
  })
  .option('wave-user-data-dir', {
    describe: 'Ruta a un perfil de navegador para reutilizar sesion/cookies con WAVE extension',
    type: 'string',
  })
  .option('wave-browser-channel', {
    describe: 'Canal de navegador para WAVE extension',
    type: 'string',
    choices: ['chromium', 'chrome', 'msedge'],
    default: 'chromium',
  })
  .option('wave-extension-timeout-ms', {
    describe: 'Tiempo maximo para detectar la interfaz de WAVE extension',
    type: 'number',
    default: 30000,
  })
  .option('wave-login-wait-ms', {
    describe: 'Tiempo extra para iniciar sesion manualmente antes de activar WAVE extension',
    type: 'number',
    default: 0,
  })
  .option('max-interactive-scenarios', {
    describe: 'Maximo de escenarios interactivos por viewport',
    type: 'number',
    default: DEFAULT_MAX_INTERACTIVE_SCENARIOS,
  })
  .option('interaction-discovery-limit', {
    describe: 'Maximo de candidatos interactivos a descubrir por viewport',
    type: 'number',
    default: DEFAULT_INTERACTION_DISCOVERY_LIMIT,
  })
  .option('prepare-page-delay-ms', {
    describe: 'Espera inicial por pagina antes de analizar',
    type: 'number',
    default: DEFAULT_PREPARE_PAGE_DELAY_MS,
  })
  .option('interaction-settle-delay-ms', {
    describe: 'Espera despues de una interaccion antes de correr axe-core',
    type: 'number',
    default: DEFAULT_INTERACTION_SETTLE_DELAY_MS,
  })
  .option('scenario-timeout-ms', {
    describe: 'Timeout maximo por escenario',
    type: 'number',
    default: DEFAULT_SCENARIO_TIMEOUT_MS,
  })
  .option('site', {
    describe: 'Audita todas las paginas del sitio descubiertas desde la URL inicial, preguntando antes de cada una (y/n/a)',
    type: 'boolean',
    default: false,
  })
  .option('asana', {
    describe: 'Crea tickets en Asana al finalizar: tarea padre + subtarea por pagina auditada',
    type: 'boolean',
    default: false,
  })
  .option('asana-token', {
    describe: 'Personal Access Token de Asana (o variables ASANA_TOKEN / ASANA_PAT)',
    type: 'string',
  })
  .option('asana-project-gid', {
    describe: 'GID del proyecto Asana destino (si no se detecta automaticamente por dominio)',
    type: 'string',
  })
  .option('save-asana-token', {
    describe: 'Guarda el token de Asana en ~/.config/smg/asana.env para no tener que pasarlo cada vez',
    type: 'string',
  })
  .check((argv) => {
    if (!argv.saveAsanaToken && !argv.url) {
      throw new Error('--url es requerida (o usa --save-asana-token TOKEN para guardar el token)');
    }
    return true;
  })
  .help()
  .argv;

const AUDIT_URL = argv.url;
const HEADLESS = !argv.headful;
const GENERATE_HTML = argv.html;
const AUDIT_MODE = argv.mode;
const SELECTED_RULES = AUDIT_MODE === 'critical' ? CRITICAL_RULES : null;
const OUTPUT_DIR = path.resolve(argv.outputDir || process.env.SMG_ACCESSIBILITY_OUTPUT_DIR || path.join(process.cwd(), '.smg-accessibility-audit'));
const WAVE_MODE = argv.wave;
const PAGE_VISIBILITY_MODE = argv.pageVisibility;
const WAVE_API_KEY = argv.waveApiKey || process.env.WAVE_API_KEY || '';
const WAVE_API_REPORT_TYPE = argv.waveApiReportType;
const WAVE_API_TIMEOUT_MS = argv.waveApiTimeoutMs;
const WAVE_EXTENSION_DIR = argv.waveExtensionDir || process.env.WAVE_EXTENSION_DIR || '';
const EXPLICIT_WAVE_USER_DATA_DIR = argv.waveUserDataDir || process.env.WAVE_USER_DATA_DIR || '';
const WAVE_USER_DATA_DIR = EXPLICIT_WAVE_USER_DATA_DIR || path.join(OUTPUT_DIR, '.wave-profile');
const WAVE_BROWSER_CHANNEL = argv.waveBrowserChannel || process.env.WAVE_BROWSER_CHANNEL || 'chromium';
const WAVE_EXTENSION_TIMEOUT_MS = argv.waveExtensionTimeoutMs;
const WAVE_LOGIN_WAIT_MS = argv.waveLoginWaitMs;
const MAX_INTERACTIVE_SCENARIOS = Math.max(0, argv.maxInteractiveScenarios);
const INTERACTION_DISCOVERY_LIMIT = Math.max(MAX_INTERACTIVE_SCENARIOS, argv.interactionDiscoveryLimit);
const PREPARE_PAGE_DELAY_MS = Math.max(0, argv.preparePageDelayMs);
const INTERACTION_SETTLE_DELAY = Math.max(0, argv.interactionSettleDelayMs);
const SCENARIO_TIMEOUT_MS = Math.max(1000, argv.scenarioTimeoutMs);
const SITE_MODE = Boolean(argv.site);
const ASANA_MODE = Boolean(argv.asana);
const ASANA_TOKEN = argv.asanaToken || process.env.ASANA_TOKEN || process.env.ASANA_PAT || loadAsanaTokenFromConfigFile();
const ASANA_FORCED_PROJECT_GID = argv.asanaProjectGid || '';
const ASANA_WORKSPACE_GID = '337970440385505';
const ASANA_API_BASE = 'https://app.asana.com/api/1.0';
let cachedInstalledWaveProfile;

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function getAsanaConfigPath() {
  return path.join(getHomeDir(), '.config', 'smg', 'asana.env');
}

function loadAsanaTokenFromConfigFile() {
  const configPath = getAsanaConfigPath();

  if (!fs.existsSync(configPath)) {
    return '';
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/^ASANA_(?:PAT|TOKEN)=(.+)$/m);
  return match ? match[1].trim() : '';
}

function saveAsanaToken(token) {
  const configDir = path.dirname(getAsanaConfigPath());
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getAsanaConfigPath(), `ASANA_PAT=${token}\n`, 'utf8');
  console.log(`Token guardado en ${getAsanaConfigPath()}`);
  console.log('A partir de ahora puedes usar --asana sin pasar el token.');
}

if (argv.saveAsanaToken) {
  saveAsanaToken(argv.saveAsanaToken);
  process.exit(0);
}

function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function slugifyUrl(url) {
  try {
    const parsed = new URL(url);
    const slug = (parsed.pathname + parsed.search)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    return slug || 'home';
  } catch {
    return 'page';
  }
}

async function discoverSiteUrls(url) {
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await navigateWithFallback(page, url);
    const baseOrigin = new URL(url).origin;
    const discovered = await page.evaluate((origin) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => {
          try {
            const href = new URL(anchor.href, window.location.href).href;
            return href.split('#')[0].replace(/\/$/, '') || null;
          } catch {
            return null;
          }
        })
        .filter((href) => {
          if (!href) {
            return false;
          }

          try {
            return new URL(href).origin === origin;
          } catch {
            return false;
          }
        });
    }, baseOrigin);
    const normalizedCurrent = url.split('#')[0].replace(/\/$/, '');

    return [...new Set(discovered)].filter((link) => link !== normalizedCurrent);
  } finally {
    await browser.close();
  }
}

function ensureOutputDirIsIgnored() {
  const defaultOutputDir = path.resolve(process.cwd(), '.smg-accessibility-audit');

  if (OUTPUT_DIR !== defaultOutputDir) {
    return;
  }

  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const ignoreEntry = '.smg-accessibility-audit/';

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${ignoreEntry}\n`, 'utf8');
    return;
  }

  const currentContent = fs.readFileSync(gitignorePath, 'utf8');
  const existingEntries = currentContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (existingEntries.includes(ignoreEntry) || existingEntries.includes('/.smg-accessibility-audit/')) {
    return;
  }

  const separator = currentContent.endsWith('\n') || currentContent.length === 0 ? '' : '\n';
  fs.writeFileSync(gitignorePath, `${currentContent}${separator}${ignoreEntry}\n`, 'utf8');
}

ensureOutputDirIsIgnored();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildViewportSummary(viewport) {
  return `${viewport.label} (${viewport.width}x${viewport.height})`;
}

function buildScenarioLabel(viewport, scenario) {
  return `${viewport.label} / ${scenario.label}`;
}

function buildContextOptions(viewport) {
  return {
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    screen: {
      width: viewport.width,
      height: viewport.height,
    },
    ...(viewport.isMobile ? { isMobile: true, hasTouch: true } : {}),
  };
}

async function runWithTimeout(taskFactory, timeoutMs, label) {
  let timeoutId;

  try {
    return await Promise.race([
      taskFactory(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout despues de ${timeoutMs}ms en ${label}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function getTagFromHtml(html) {
  const tagMatch = html && html.match(/^\s*<\s*([a-zA-Z0-9-]+)/);
  return tagMatch ? tagMatch[1].toLowerCase() : 'unknown';
}

async function getElementMetadata(page, selector) {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);

    const getNearestParentLocator = (el) => {
      let current = el ? el.parentElement : null;

      while (current) {
        const className = (current.className || '').toString().trim();
        const classList = className.length > 0
          ? className.split(/\s+/).filter(Boolean)
          : [];

        if (current.id || classList.length > 0) {
          const idPart = current.id ? `#${current.id}` : '';
          const classPart = classList.length > 0
            ? `.${classList.map((cls) => CSS.escape(cls)).join('.')}`
            : '';

          return `${current.tagName.toLowerCase()}${idPart}${classPart}`;
        }

        current = current.parentElement;
      }

      return '(sin padre con id/clase)';
    };

    if (!element) {
      return {
        fullSelector: targetSelector,
        className: '(no encontrado)',
        tagName: '(no encontrado)',
        nearestParent: '(no encontrado)',
      };
    }

    const buildSelector = (el) => {
      if (el.id) {
        return `#${CSS.escape(el.id)}`;
      }

      const pathParts = [];
      let current = el;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let part = current.tagName.toLowerCase();

        if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).map((cls) => CSS.escape(cls)).join('.')}`;
        }

        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : [];

        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }

        pathParts.unshift(part);
        current = current.parentElement;
      }

      return pathParts.join(' > ');
    };

    return {
      fullSelector: buildSelector(element),
      className: element.className || '(sin clase)',
      tagName: element.tagName.toLowerCase(),
      nearestParent: getNearestParentLocator(element),
    };
  }, selector);
}

function translateImpact(impact) {
  const impactMap = {
    critical: 'critico',
    serious: 'grave',
    moderate: 'moderado',
    minor: 'menor',
  };

  return impactMap[impact] || impact || 'No disponible';
}

function translateAxeSummary(summary) {
  if (!summary) {
    return '';
  }

  return summary
    .replace(/Fix all of the following:/g, 'Corrige todo lo siguiente:')
    .replace(/Fix any of the following:/g, 'Corrige cualquiera de los siguientes puntos:')
    .replace(/Element has insufficient color contrast of/g, 'El elemento tiene contraste de color insuficiente de')
    .replace(/Expected contrast ratio of/g, 'Se esperaba una relacion de contraste de')
    .replace(/Element is in tab order and does not have accessible text/g, 'El elemento esta en el orden de tabulacion y no tiene texto accesible')
    .replace(/Element does not have text that is visible to screen readers/g, 'El elemento no tiene texto visible para lectores de pantalla')
    .replace(/aria-label attribute does not exist or is empty/g, 'El atributo aria-label no existe o esta vacio')
    .replace(/aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty/g, 'El atributo aria-labelledby no existe, referencia elementos inexistentes o vacios')
    .replace(/Element has no title attribute/g, 'El elemento no tiene atributo title')
    .replace(/Element does not have an alt attribute/g, 'El elemento no tiene atributo alt')
    .replace(/Element's default semantics were not overridden with role="none" or role="presentation"/g, 'La semantica por defecto del elemento no fue reemplazada con role="none" o role="presentation"');
}

function getFixStrategy(ruleId) {
  return AUTO_FIXABLE_RULES.has(ruleId) ? 'autofix' : 'manual';
}

function getFixStrategyLabel(ruleId) {
  return AUTO_FIXABLE_RULES.has(ruleId)
    ? 'Autofix disponible'
    : 'Correccion manual requerida';
}

function shortenText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || '';
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function formatRuleList(label, ruleIds) {
  if (!ruleIds || ruleIds.length === 0) {
    return `${label}: ninguna`;
  }

  return [
    `${label}:`,
    ...sortRuleIds(ruleIds).map((ruleId) => `  - ${ruleId}`),
  ].join('\n');
}

function clampProgressPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function logAuditProgress(percent, label) {
  console.log(`[${clampProgressPercent(percent)}%] ${label}`);
}

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseCountLabel(value) {
  const normalizedValue = normalizeText(value);
  const countMatch = normalizedValue.match(/^(\d+)\s+(.+)$/);

  if (!countMatch) {
    return {
      count: null,
      label: normalizedValue,
    };
  }

  return {
    count: Number(countMatch[1]),
    label: countMatch[2].trim(),
  };
}

function buildWaveSampleLabel(sample, fallbackLabel) {
  const normalizedSample = normalizeText(sample);
  return normalizedSample || fallbackLabel || 'Sin muestra disponible';
}

function mapWaveSummaryCategory(summaryId) {
  return WAVE_SUMMARY_CATEGORY_IDS[summaryId] || summaryId || 'unknown';
}

function looksLikeProtectedUrl(url) {
  return WAVE_PROTECTED_URL_PATTERNS.some((pattern) => pattern.test(url || ''));
}

function looksLikeProtectedHtml(html) {
  return WAVE_PROTECTED_BODY_PATTERNS.some((pattern) => pattern.test(html || ''));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function detectPageVisibility(url) {
  if (PAGE_VISIBILITY_MODE !== 'auto') {
    return {
      visibility: PAGE_VISIBILITY_MODE,
      detection: 'override',
      reason: `Forzado por --page-visibility=${PAGE_VISIBILITY_MODE}`,
      requestedUrl: url,
      finalUrl: url,
      statusCode: null,
    };
  }

  try {
    const response = await fetchWithTimeout(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'SMG Accessibility Visibility Check',
      },
    }, VISIBILITY_CHECK_TIMEOUT_MS);
    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') || '';

    if (response.status === 401 || response.status === 403) {
      return {
        visibility: 'private',
        detection: 'http-status',
        reason: `HTTP ${response.status}`,
        requestedUrl: url,
        finalUrl,
        statusCode: response.status,
      };
    }

    if (looksLikeProtectedUrl(finalUrl)) {
      return {
        visibility: 'private',
        detection: 'redirect-pattern',
        reason: `La URL final parece una pantalla restringida: ${finalUrl}`,
        requestedUrl: url,
        finalUrl,
        statusCode: response.status,
      };
    }

    const htmlSample = contentType.includes('text/html')
      ? (await response.text()).slice(0, 12000)
      : '';

    if (looksLikeProtectedHtml(htmlSample)) {
      return {
        visibility: 'private',
        detection: 'html-pattern',
        reason: 'La respuesta parece una pantalla de login, password o desafio.',
        requestedUrl: url,
        finalUrl,
        statusCode: response.status,
      };
    }

    if (response.ok) {
      return {
        visibility: 'public',
        detection: 'http-response',
        reason: 'La URL responde sin autenticacion aparente.',
        requestedUrl: url,
        finalUrl,
        statusCode: response.status,
      };
    }

    return {
      visibility: 'unknown',
      detection: 'http-response',
      reason: `HTTP ${response.status}`,
      requestedUrl: url,
      finalUrl,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      visibility: 'unknown',
      detection: 'request-error',
      reason: error.message,
      requestedUrl: url,
      finalUrl: url,
      statusCode: null,
    };
  }
}

function isWaveExtensionConfigured() {
  const autoDetectedWaveProfile = getInstalledWaveProfile();

  return Boolean(
    (WAVE_EXTENSION_DIR && WAVE_EXTENSION_DIR.trim())
    || (EXPLICIT_WAVE_USER_DATA_DIR && WAVE_BROWSER_CHANNEL !== 'chromium')
    || autoDetectedWaveProfile,
  );
}

function ensureWaveApiConfigured() {
  if (!WAVE_API_KEY) {
    throw new Error('Falta WAVE_API_KEY o --wave-api-key para usar la API de WAVE.');
  }
}

function getWaveExtensionLaunchConfig(visibility) {
  const hasExtensionDir = Boolean(WAVE_EXTENSION_DIR && WAVE_EXTENSION_DIR.trim());
  const hasBrowserProfile = Boolean(EXPLICIT_WAVE_USER_DATA_DIR && EXPLICIT_WAVE_USER_DATA_DIR.trim());
  const shouldReuseInstalledProfile = visibility && visibility.visibility === 'private';

  if (!hasExtensionDir && !hasBrowserProfile) {
    const autoDetectedWaveProfile = getInstalledWaveProfile();

    if (!autoDetectedWaveProfile) {
      throw new Error('No se encontro WAVE instalada en perfiles locales. Instalala en Edge/Chrome o configura --wave-extension-dir/--wave-user-data-dir.');
    }

    return {
      browserChannel: autoDetectedWaveProfile.browserChannel,
      extensionDir: shouldReuseInstalledProfile ? '' : autoDetectedWaveProfile.extensionVersionDir,
      userDataDir: shouldReuseInstalledProfile
        ? autoDetectedWaveProfile.userDataRoot
        : path.join(WAVE_USER_DATA_DIR, 'auto-detected-wave'),
      profileDirectory: shouldReuseInstalledProfile ? autoDetectedWaveProfile.profileDirectory : '',
      notes: [
        `WAVE extension autodetectada en ${autoDetectedWaveProfile.browserLabel} (${autoDetectedWaveProfile.profileDirectory}).`,
        shouldReuseInstalledProfile
          ? 'WAVE reutiliza el perfil real para conservar sesion/cookies en una pagina privada.'
          : 'WAVE usa una copia aislada de la extension para evitar bloqueos del perfil real en una pagina publica.',
      ],
    };
  }

  if (hasExtensionDir) {
    const extensionDir = path.resolve(WAVE_EXTENSION_DIR);

    if (!fs.existsSync(extensionDir)) {
      throw new Error(`No existe la ruta de WAVE extension: ${extensionDir}`);
    }

    return {
      browserChannel: 'chromium',
      extensionDir,
      userDataDir: hasBrowserProfile ? path.resolve(EXPLICIT_WAVE_USER_DATA_DIR) : WAVE_USER_DATA_DIR,
      profileDirectory: '',
      notes: ['WAVE extension cargada como extension descomprimida en Chromium.'],
    };
  }

  const userDataDir = path.resolve(EXPLICIT_WAVE_USER_DATA_DIR);

  if (!fs.existsSync(userDataDir)) {
    throw new Error(`No existe el perfil indicado para WAVE extension: ${userDataDir}`);
  }

  return {
    browserChannel: WAVE_BROWSER_CHANNEL,
    extensionDir: '',
    userDataDir,
    profileDirectory: '',
    notes: [`WAVE extension reutiliza el perfil ${WAVE_BROWSER_CHANNEL}.`],
  };
}

function getKnownWaveBrowserInstallations() {
  return WAVE_BROWSER_INSTALLATIONS[process.platform] || [];
}

function getCandidateProfileDirectories(userDataRoot) {
  if (!userDataRoot || !fs.existsSync(userDataRoot)) {
    return [];
  }

  return fs.readdirSync(userDataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || /^Profile\s+\d+$/i.test(entry.name)))
    .map((entry) => entry.name);
}

function getLatestExtensionVersionDir(extensionRoot) {
  if (!extensionRoot || !fs.existsSync(extensionRoot)) {
    return '';
  }

  const versionDirs = fs.readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));

  for (const versionDir of versionDirs) {
    const manifestPath = path.join(extensionRoot, versionDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      return path.join(extensionRoot, versionDir);
    }
  }

  return '';
}

function detectInstalledWaveProfile() {
  for (const installation of getKnownWaveBrowserInstallations()) {
    const profileDirectories = getCandidateProfileDirectories(installation.userDataRoot);

    for (const profileDirectory of profileDirectories) {
      const extensionRoot = path.join(installation.userDataRoot, profileDirectory, 'Extensions', installation.extensionId);
      const extensionVersionDir = getLatestExtensionVersionDir(extensionRoot);

      if (!extensionVersionDir) {
        continue;
      }

      return {
        browserChannel: installation.browserChannel,
        browserLabel: installation.browserLabel,
        userDataRoot: installation.userDataRoot,
        profileDirectory,
        extensionRoot,
        extensionVersionDir,
      };
    }
  }

  return null;
}

function getInstalledWaveProfile() {
  if (cachedInstalledWaveProfile !== undefined) {
    return cachedInstalledWaveProfile;
  }

  cachedInstalledWaveProfile = detectInstalledWaveProfile();
  return cachedInstalledWaveProfile;
}

function normalizeWaveContrastSamples(contrastData) {
  if (!Array.isArray(contrastData)) {
    return [];
  }

  return contrastData
    .filter((entry) => Array.isArray(entry) && entry.length >= 4)
    .slice(0, 5)
    .map(([ratio, foreground, background, largeText]) => ({
      ratio,
      foreground,
      background,
      largeText,
    }));
}

function normalizeWaveApiItems(categoryId, category) {
  if (!category || !category.items) {
    return [];
  }

  return Object.values(category.items).map((item) => ({
    categoryId,
    itemId: item.id || '',
    description: item.description || item.id || 'Sin descripcion',
    count: Number(item.count || 0),
    selectors: Array.isArray(item.selectors) ? item.selectors.filter(Boolean) : [],
    xpaths: Array.isArray(item.xpaths) ? item.xpaths.filter(Boolean) : [],
    sampleAlts: [],
    sampleNodes: [],
    contrastSamples: normalizeWaveContrastSamples(item.contrastdata),
  }));
}

function normalizeWaveItemLabel(value) {
  return normalizeText(value).toLowerCase();
}

function mergeWaveItemNodeDetails(items, nodeDetails) {
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(nodeDetails) || nodeDetails.length === 0) {
    return items || [];
  }

  return items.map((item) => {
    const matchedNodes = nodeDetails.filter((nodeDetail) => (
      nodeDetail.categoryId === item.categoryId
      && normalizeWaveItemLabel(nodeDetail.description) === normalizeWaveItemLabel(item.description)
    ));

    const enrichedNodes = matchedNodes.map((nodeDetail, index) => ({
      ...nodeDetail,
      description: item.description || nodeDetail.description || 'Contraste insuficiente',
      contrastSample: item.contrastSamples && item.contrastSamples.length > 0
        ? item.contrastSamples[index] || item.contrastSamples[0]
        : null,
    }));

    return {
      ...item,
      sampleNodes: enrichedNodes,
      selectors: item.selectors && item.selectors.length > 0
        ? item.selectors
        : enrichedNodes.map((nodeDetail) => nodeDetail.selector).filter(Boolean),
    };
  });
}

async function extractWaveAnnotatedNodeDetails(frame) {
  return frame.evaluate(() => {
    const normalizeValue = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const categoryMap = {
      'ERRORS': 'error',
      'CONTRAST ERRORS': 'contrast',
      'ALERTS': 'alert',
      'FEATURES': 'feature',
      'STRUCTURAL ELEMENTS': 'structure',
      'ARIA': 'aria',
    };
    const buildSelector = (element) => {
      if (!element || !(element instanceof Element)) {
        return '';
      }

      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const pathParts = [];
      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let part = current.tagName.toLowerCase();

        if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).map((className) => CSS.escape(className)).join('.')}`;
        }

        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : [];

        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }

        pathParts.unshift(part);
        current = current.parentElement;

        if (pathParts.length >= 5) {
          break;
        }
      }

      return pathParts.join(' > ');
    };
    const getNearestParentElement = (element) => {
      let current = element ? element.parentElement : null;

      while (current) {
        const className = normalizeValue(current.className);
        const classList = className.length > 0 ? className.split(/\s+/).filter(Boolean) : [];

        if (current.id || classList.length > 0) {
          return current;
        }

        current = current.parentElement;
      }

      return null;
    };
    const getNearestParentLocator = (element) => {
      const parentElement = getNearestParentElement(element);

      if (!parentElement) {
        return '(sin padre con id/clase)';
      }

      const className = normalizeValue(parentElement.className);
      const classList = className.length > 0 ? className.split(/\s+/).filter(Boolean) : [];
      const idPart = parentElement.id ? `#${parentElement.id}` : '';
      const classPart = classList.length > 0 ? `.${classList.map((cls) => CSS.escape(cls)).join('.')}` : '';

      return `${parentElement.tagName.toLowerCase()}${idPart}${classPart}`;
    };
    const getCleanHtml = (element) => {
      if (!element) {
        return '';
      }

      const clone = element.cloneNode(true);
      clone.querySelectorAll('.wave5icon').forEach((icon) => icon.remove());
      return normalizeValue(clone.outerHTML);
    };
    const getTextSnippet = (element) => {
      if (!element) {
        return '';
      }

      const clone = element.cloneNode(true);
      clone.querySelectorAll('.wave5icon').forEach((icon) => icon.remove());
      return normalizeValue(clone.textContent || '');
    };
    const getCategoryAndDescription = (alt) => {
      const normalizedAlt = normalizeValue(alt);
      const separatorIndex = normalizedAlt.indexOf(':');

      if (separatorIndex === -1) {
        return {
          categoryId: 'unknown',
          description: normalizedAlt,
        };
      }

      const categoryLabel = normalizedAlt.slice(0, separatorIndex).trim().toUpperCase();
      const description = normalizedAlt.slice(separatorIndex + 1).trim();

      return {
        categoryId: categoryMap[categoryLabel] || categoryLabel.toLowerCase(),
        description,
      };
    };
    const fingerprints = new Set();

    return Array.from(document.querySelectorAll('.wave5icon'))
      .map((icon) => {
        const alt = normalizeValue(icon.getAttribute('alt'));

        if (!alt) {
          return null;
        }

        const target = icon.parentElement;

        if (!target || ['html', 'head', 'body'].includes(target.tagName.toLowerCase())) {
          return null;
        }

        const { categoryId, description } = getCategoryAndDescription(alt);
        const selector = buildSelector(target);
        const html = getCleanHtml(target);
        const nearestParentElement = getNearestParentElement(target);
        const fingerprint = [categoryId, description, selector, html].join('::');

        if (fingerprints.has(fingerprint)) {
          return null;
        }

        fingerprints.add(fingerprint);

        return {
          categoryId,
          description,
          selector,
          metadata: {
            className: normalizeValue(target.className) || '(sin clase)',
            tagName: target.tagName.toLowerCase(),
            nearestParent: getNearestParentLocator(target),
            nearestParentHtml: nearestParentElement ? getCleanHtml(nearestParentElement) : '',
          },
          textSnippet: getTextSnippet(target),
          html,
        };
      })
      .filter(Boolean);
  });
}

function normalizeWaveApiResult(requestedUrl, waveJson) {
  const categories = waveJson.categories || {};
  const categoryIds = ['error', 'contrast', 'alert', 'feature', 'structure', 'aria'];
  const normalizedCategories = categoryIds
    .map((categoryId) => {
      const category = categories[categoryId];

      if (!category) {
        return null;
      }

      return {
        categoryId,
        label: category.description || categoryId,
        count: Number(category.count || 0),
      };
    })
    .filter(Boolean);

  const items = categoryIds.flatMap((categoryId) => normalizeWaveApiItems(categoryId, categories[categoryId]));
  const statistics = waveJson.statistics || {};

  return {
    enabled: true,
    status: 'ok',
    source: 'api',
    requestedStrategy: WAVE_MODE,
    requestedUrl,
    analyzedUrl: statistics.pageurl || requestedUrl,
    waveUrl: statistics.waveurl || '',
    counts: {
      allItems: Number(statistics.allitemcount || 0),
      totalElements: Number(statistics.totalelements || 0),
      aimScore: statistics.AIMscore || 'No disponible',
      creditsRemaining: statistics.creditsremaining || 'No disponible',
      httpStatusCode: waveJson.status && waveJson.status.httpstatuscode ? waveJson.status.httpstatuscode : 'No disponible',
    },
    categories: normalizedCategories,
    items,
    notes: [],
    raw: waveJson,
  };
}

function inferPrivateFromWaveApiResult(waveResult) {
  return looksLikeProtectedUrl(waveResult.analyzedUrl);
}

async function runWaveApiAudit(url) {
  ensureWaveApiConfigured();

  const searchParams = new URLSearchParams({
    key: WAVE_API_KEY,
    url,
    format: 'json',
    reporttype: String(WAVE_API_REPORT_TYPE),
    viewportwidth: String(WAVE_API_VIEWPORT_WIDTH),
    evaldelay: '1200',
  });
  const response = await fetchWithTimeout(`${WAVE_API_ENDPOINT}?${searchParams.toString()}`, {
    headers: {
      accept: 'application/json',
    },
  }, WAVE_API_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`WAVE API respondio con HTTP ${response.status}.`);
  }

  const waveJson = await response.json();

  if (!waveJson.status || !waveJson.status.success) {
    const apiError = waveJson.status && waveJson.status.error ? waveJson.status.error : 'respuesta invalida';
    throw new Error(`WAVE API no pudo analizar la URL: ${apiError}`);
  }

  return normalizeWaveApiResult(url, waveJson);
}

async function waitForWaveInterface(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const frames = [page.mainFrame(), ...page.frames().filter((frame) => frame !== page.mainFrame())];

    for (const frame of frames) {
      const hasWaveUi = await frame.evaluate(() => Boolean(
        document.querySelector('#sidebar_container')
        || document.querySelector('#wave_sidebar_toggle')
        || document.querySelector('#iconlist')
        || document.querySelector('#contrastlist')
        || document.querySelector('#numbers')
      )).catch(() => false);

      if (hasWaveUi) {
        return frame;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error('No se detecto la interfaz WAVE extension dentro del tiempo esperado.');
}

async function triggerWaveExtension(page) {
  await page.bringToFront().catch(() => {});
  await page.locator('body').click({ timeout: 2000, position: { x: 20, y: 20 } }).catch(() => {});
  await page.keyboard.press(WAVE_EXTENSION_SHORTCUT);
  await page.waitForTimeout(WAVE_UI_DISCOVERY_DELAY_MS);
}

async function extractWaveDomResult(frame) {
  return frame.evaluate(() => {
    const normalizeValue = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const parseCounter = (value) => {
      const normalizedValue = normalizeValue(value);
      const match = normalizedValue.match(/^(\d+)\s+(.+)$/);

      if (!match) {
        return {
          count: null,
          label: normalizedValue,
        };
      }

      return {
        count: Number(match[1]),
        label: match[2].trim(),
      };
    };
    const parseCategoryCount = (node) => {
      const parsed = parseCounter(node ? node.innerText : '');
      return {
        summaryId: node ? node.id : '',
        count: parsed.count || 0,
        label: parsed.label,
      };
    };
    const groupNodes = Array.from(document.querySelectorAll('#iconlist .icon_group'));
    const items = groupNodes.flatMap((groupNode) => {
      const groupId = ((groupNode.querySelector('h3') || {}).id || '').replace(/^group_/, '') || 'unknown';
      const typeNodes = Array.from(groupNode.querySelectorAll(':scope > ul > li.icon_type'));

      return typeNodes.map((typeNode) => {
        const toggleNode = typeNode.querySelector('h4 input[id^="toggle_type_"]');
        const labelNode = typeNode.querySelector('h4 label');
        const label = parseCounter(labelNode ? labelNode.innerText : '');
        const sampleAlts = Array.from(typeNode.querySelectorAll('ul li img'))
          .map((image) => normalizeValue(
            image.getAttribute('alt')
            || image.getAttribute('aria-label')
            || image.getAttribute('title')
            || image.parentElement?.innerText,
          ))
          .filter(Boolean);

        return {
          categoryId: groupId,
          itemId: toggleNode ? toggleNode.id.replace(/^toggle_type_/, '') : '',
          description: label.label || 'Sin descripcion',
          count: label.count || sampleAlts.length || 0,
          selectors: [],
          xpaths: [],
          sampleAlts,
          sampleNodes: [],
          contrastSamples: [],
        };
      });
    });

    return {
      categories: Array.from(document.querySelectorAll('#numbers li')).map(parseCategoryCount),
      items,
      rawText: {
        iconlist: normalizeValue(document.querySelector('#iconlist')?.innerText || ''),
        contrastlist: normalizeValue(document.querySelector('#contrastlist')?.innerText || ''),
      },
    };
  });
}

function normalizeWaveExtensionResult(requestedUrl, analyzedUrl, rawWaveDom, notes) {
  const categories = (rawWaveDom.categories || []).map((category) => ({
    categoryId: mapWaveSummaryCategory(category.summaryId),
    label: category.label || mapWaveSummaryCategory(category.summaryId),
    count: Number(category.count || 0),
  }));
  const allItems = categories.reduce((sum, category) => sum + Number(category.count || 0), 0);

  return {
    enabled: true,
    status: 'ok',
    source: 'extension',
    requestedStrategy: WAVE_MODE,
    requestedUrl,
    analyzedUrl,
    waveUrl: '',
    counts: {
      allItems,
      totalElements: 'No disponible',
      aimScore: 'No disponible',
      creditsRemaining: 'No aplica',
      httpStatusCode: 'No disponible',
    },
    categories,
    items: rawWaveDom.items || [],
    notes: [
      ...(notes || []),
      'La ruta WAVE extension obtiene conteos e items desde la interfaz inyectada; el detalle por selector depende de la UI disponible.',
      ...(rawWaveDom.rawText && rawWaveDom.rawText.contrastlist
        ? []
        : ['WAVE extension no expuso una lista de contraste estructurada en esta ejecucion.']),
    ],
    raw: rawWaveDom,
  };
}

function normalizeWaveReportPageResult(requestedUrl, waveReportUrl, rawWaveDom, notes) {
  const categories = (rawWaveDom.categories || []).map((category) => ({
    categoryId: mapWaveSummaryCategory(category.summaryId),
    label: category.label || mapWaveSummaryCategory(category.summaryId),
    count: Number(category.count || 0),
  }));
  const allItems = categories.reduce((sum, category) => sum + Number(category.count || 0), 0);

  return {
    enabled: true,
    status: 'ok',
    source: 'web-report',
    requestedStrategy: WAVE_MODE,
    requestedUrl,
    analyzedUrl: requestedUrl,
    waveUrl: waveReportUrl,
    counts: {
      allItems,
      totalElements: 'No disponible',
      aimScore: 'No disponible',
      creditsRemaining: 'No aplica',
      httpStatusCode: 'No disponible',
    },
    categories,
    items: rawWaveDom.items || [],
    notes: [
      ...(notes || []),
      'WAVE se obtuvo desde el reporte publico de WebAIM para esta URL.',
      ...(rawWaveDom.rawText && rawWaveDom.rawText.contrastlist
        ? []
        : ['El reporte publico de WAVE no expuso detalle estructurado de contraste en esta ejecucion.']),
    ],
    raw: rawWaveDom,
  };
}

async function runWaveReportPageAudit(url) {
  const browser = await chromium.launch({ headless: HEADLESS });
  const waveReportUrl = `${WAVE_REPORT_URL}?url=${encodeURIComponent(url)}`;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await navigateWithFallback(page, waveReportUrl);
    const waveFrame = await waitForWaveInterface(page, WAVE_EXTENSION_TIMEOUT_MS);
    const rawWaveDom = await extractWaveDomResult(waveFrame);
    const reportFrame = page.frames().find((frame) => frame.name() === 'report') || page.mainFrame();
    const nodeDetails = await extractWaveAnnotatedNodeDetails(reportFrame);
    rawWaveDom.items = mergeWaveItemNodeDetails(rawWaveDom.items, nodeDetails);

    return normalizeWaveReportPageResult(url, waveReportUrl, rawWaveDom, []);
  } finally {
    await browser.close();
  }
}

async function runWaveExtensionAudit(url, visibility) {
  const launchConfig = getWaveExtensionLaunchConfig(visibility);
  const launchArgs = [];

  if (launchConfig.extensionDir) {
    launchArgs.push(`--disable-extensions-except=${launchConfig.extensionDir}`);
    launchArgs.push(`--load-extension=${launchConfig.extensionDir}`);
  }

  if (launchConfig.profileDirectory) {
    launchArgs.push(`--profile-directory=${launchConfig.profileDirectory}`);
  }

  const context = await chromium.launchPersistentContext(launchConfig.userDataDir, {
    headless: false,
    channel: launchConfig.browserChannel === 'chromium' ? undefined : launchConfig.browserChannel,
    args: launchArgs,
    ignoreDefaultArgs: ['--disable-extensions'],
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await navigateWithFallback(page, url);
    await preparePageForAudit(page);

    if (WAVE_LOGIN_WAIT_MS > 0) {
      console.log(`Esperando ${WAVE_LOGIN_WAIT_MS}ms para completar login/sesion antes de activar WAVE extension...`);
      await page.waitForTimeout(WAVE_LOGIN_WAIT_MS);
    }

    await triggerWaveExtension(page);
    const waveFrame = await waitForWaveInterface(page, WAVE_EXTENSION_TIMEOUT_MS);
    const rawWaveDom = await extractWaveDomResult(waveFrame);

    return normalizeWaveExtensionResult(url, page.url(), rawWaveDom, launchConfig.notes);
  } finally {
    await context.close();
  }
}

function buildWaveUnavailableResult(status, notes, visibility) {
  return {
    enabled: true,
    status,
    source: 'none',
    requestedStrategy: WAVE_MODE,
    requestedUrl: AUDIT_URL,
    analyzedUrl: AUDIT_URL,
    waveUrl: '',
    counts: {
      allItems: 0,
      totalElements: 'No disponible',
      aimScore: 'No disponible',
      creditsRemaining: 'No disponible',
      httpStatusCode: 'No disponible',
    },
    categories: [],
    items: [],
    notes: notes || [],
    visibility,
  };
}

async function runWaveAnalysis(url, visibility) {
  if (WAVE_MODE === 'off') {
    return {
      enabled: false,
      status: 'skipped',
      source: 'off',
      requestedStrategy: 'off',
      requestedUrl: url,
      analyzedUrl: url,
      waveUrl: '',
      counts: {
        allItems: 0,
        totalElements: 'No disponible',
        aimScore: 'No disponible',
        creditsRemaining: 'No disponible',
        httpStatusCode: 'No disponible',
      },
      categories: [],
      items: [],
      notes: ['Integracion WAVE desactivada.'],
      visibility,
    };
  }

  if (WAVE_MODE === 'api') {
    const waveResult = await runWaveApiAudit(url);
    waveResult.visibility = visibility;
    return waveResult;
  }

  if (WAVE_MODE === 'extension') {
    const waveResult = await runWaveExtensionAudit(url, visibility);
    waveResult.visibility = visibility;
    return waveResult;
  }

  const notes = [];
  const extensionAvailable = isWaveExtensionConfigured();
  const apiAvailable = Boolean(WAVE_API_KEY);
  const preferredStrategies = extensionAvailable
    ? ['extension', 'api', 'web-report']
    : apiAvailable
      ? ['api', 'web-report', 'extension']
      : ['web-report', 'extension', 'api'];

  for (const strategy of preferredStrategies) {
    try {
      if (strategy === 'api') {
        if (!WAVE_API_KEY) {
          notes.push('WAVE API omitida: no hay API key configurada.');
          continue;
        }

        const apiResult = await runWaveApiAudit(url);

        if ((visibility.visibility === 'private' && extensionAvailable) || inferPrivateFromWaveApiResult(apiResult)) {
          notes.push('WAVE API devolvio una URL final con apariencia restringida; se intentara WAVE extension.');
          continue;
        }

        apiResult.visibility = visibility;
        apiResult.notes.unshift(`Seleccion automatica: se uso WAVE API (${visibility.reason}).`);
        return apiResult;
      }

      if (strategy === 'web-report') {
        if (visibility.visibility === 'private') {
          notes.push('WAVE web-report omitido: la pagina parece privada.');
          continue;
        }

        const webReportResult = await runWaveReportPageAudit(url);
        webReportResult.visibility = visibility;
        webReportResult.notes.unshift(`Seleccion automatica: se uso WAVE web-report (${visibility.reason}).`);
        return webReportResult;
      }

      if (!isWaveExtensionConfigured()) {
        notes.push('WAVE extension omitida: no hay configuracion disponible.');
        continue;
      }

      const extensionResult = await runWaveExtensionAudit(url, visibility);
      extensionResult.visibility = visibility;
      extensionResult.notes.unshift(`Seleccion automatica: se uso WAVE extension (${visibility.reason}).`);
      return extensionResult;
    } catch (error) {
      notes.push(`${strategy === 'api' ? 'WAVE API' : 'WAVE extension'} fallo: ${error.message}`);
    }
  }

  return buildWaveUnavailableResult('error', notes, visibility);
}

function compareRuleIds(leftRuleId, rightRuleId) {
  const leftPriority = REPORT_PRIORITY_RULES.indexOf(leftRuleId);
  const rightPriority = REPORT_PRIORITY_RULES.indexOf(rightRuleId);
  const normalizedLeftPriority = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
  const normalizedRightPriority = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

  if (normalizedLeftPriority !== normalizedRightPriority) {
    return normalizedLeftPriority - normalizedRightPriority;
  }

  return leftRuleId.localeCompare(rightRuleId);
}

function sortRuleIds(ruleIds) {
  return [...ruleIds].sort(compareRuleIds);
}

function sortViolations(violations) {
  return [...violations].sort((leftViolation, rightViolation) => compareRuleIds(leftViolation.id, rightViolation.id));
}

function getScenarioLabels(node) {
  return uniqueValues(node.scenarioLabels || []);
}

function buildNodeFingerprint(ruleId, node) {
  const target = Array.isArray(node.target) ? node.target.join(' || ') : '';
  const normalizedHtml = node.html
    ? node.html.replace(/\s+/g, ' ').trim()
    : '';
  const summary = node.failureSummary || '';
  const contrastDetails = ruleId === 'color-contrast'
    ? JSON.stringify(extractContrastDetails(node))
    : '';

  return [ruleId, target, normalizedHtml, summary, contrastDetails].join('::');
}

function extractContrastDetails(node) {
  const structuredContrast = node.any
    && node.any[0]
    && node.any[0].data
    && node.any[0].data.contrast;

  if (structuredContrast && structuredContrast.ratio && structuredContrast.threshold) {
    return {
      ratio: structuredContrast.ratio,
      min: structuredContrast.threshold,
    };
  }

  const summary = node.failureSummary || '';
  const ratioMatch = summary.match(/contrast of\s+([0-9.]+)/i);
  const thresholdMatch = summary.match(/Expected contrast ratio of\s+([0-9.]+)/i);

  return {
    ratio: ratioMatch ? ratioMatch[1] : 'No disponible',
    min: thresholdMatch ? thresholdMatch[1] : 'No disponible',
  };
}

function extractContrastSample(node) {
  const structuredContrast = node.any
    && node.any[0]
    && node.any[0].data
    && node.any[0].data.contrast;

  if (!structuredContrast) {
    return null;
  }

  return {
    ratio: structuredContrast.ratio || 'No disponible',
    foreground: structuredContrast.foreground
      || structuredContrast.fgColor
      || structuredContrast.fg
      || structuredContrast.foregroundColor
      || '',
    background: structuredContrast.background
      || structuredContrast.bgColor
      || structuredContrast.bg
      || structuredContrast.backgroundColor
      || '',
    largeText: Boolean(structuredContrast.isLargeText || structuredContrast.largeText),
  };
}

function parseContrastNumber(value) {
  const normalizedValue = String(value || '').replace(',', '.').trim();
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatContrastMetric(value) {
  const parsedValue = parseContrastNumber(value);

  if (parsedValue === null) {
    return value || 'No disponible';
  }

  return `${parsedValue.toFixed(2)}:1`;
}

function buildContrastFailureReason({ ratio, min, detail, contrastSample }) {
  const ratioValue = parseContrastNumber(ratio);
  const minValue = parseContrastNumber(min);
  const reasonParts = [];

  if (ratioValue !== null && minValue !== null) {
    reasonParts.push(`El contraste detectado es ${formatContrastMetric(ratio)} y el minimo requerido es ${formatContrastMetric(min)}.`);

    if (ratioValue < minValue) {
      reasonParts.push(`Le faltan ${(minValue - ratioValue).toFixed(2)} puntos de contraste para cumplir.`);
    }
  } else if (detail) {
    reasonParts.push(detail);
  } else {
    reasonParts.push('El color del texto y el color del fondo se parecen demasiado y no alcanzan el contraste minimo exigido.');
  }

  if (contrastSample && contrastSample.foreground && contrastSample.background) {
    reasonParts.push(`Colores detectados: texto ${contrastSample.foreground} sobre fondo ${contrastSample.background}.`);
  }

  if (contrastSample && contrastSample.largeText) {
    reasonParts.push('El elemento fue detectado como texto grande.');
  }

  return reasonParts.join(' ');
}

function inferContrastContext({ tagName, className, nearestParent, html }) {
  const haystack = [tagName, className, nearestParent, html]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/hero|banner|slider|carousel|video|image/.test(haystack)) {
    return 'hero';
  }

  if (tagName === 'button' || /button|btn|cta/.test(haystack)) {
    return 'button';
  }

  if (tagName === 'a' || /link|nav/.test(haystack)) {
    return 'link';
  }

  if (/^h[1-6]$/.test(tagName || '') || /heading|title|headline/.test(haystack)) {
    return 'heading';
  }

  return 'text';
}

function buildContrastMetricLabel({ ratio, min, contrastSample, detail }) {
  const ratioValue = parseContrastNumber(ratio);
  const minValue = parseContrastNumber(min);

  if (ratioValue !== null && minValue !== null) {
    return `Contraste: ${formatContrastMetric(ratio)} / minimo ${formatContrastMetric(min)}`;
  }

  if (contrastSample && contrastSample.largeText) {
    return 'Contraste insuficiente detectado para texto grande';
  }

  if (detail) {
    return 'Contraste insuficiente detectado';
  }

  return 'Contraste marcado por WAVE (sin ratio exacto en esta corrida)';
}

function buildContrastClientSummary(summary) {
  const ratioValue = parseContrastNumber(summary.ratio);
  const minValue = parseContrastNumber(summary.min);
  const context = inferContrastContext(summary);

  if (ratioValue !== null && minValue !== null) {
    const baseMessage = `El texto no destaca lo suficiente sobre el fondo: tiene ${formatContrastMetric(summary.ratio)} y deberia llegar al menos a ${formatContrastMetric(summary.min)}.`;

    if (context === 'hero') {
      return `${baseMessage} En este caso ocurre dentro del hero, donde la imagen o video compite con la lectura.`;
    }

    return baseMessage;
  }

  if (context === 'hero' || context === 'heading') {
    return 'El titular se mezcla con el fondo visual y cuesta leerlo de inmediato, especialmente en la imagen o video del hero.';
  }

  if (context === 'button') {
    return 'La llamada a la accion no resalta lo suficiente frente a su fondo y puede pasar desapercibida.';
  }

  if (context === 'link') {
    return 'El enlace no se diferencia lo suficiente del fondo y pierde legibilidad.';
  }

  return 'El texto se parece demasiado al fondo y no se lee con claridad a simple vista.';
}

function buildContrastActionPlan(summary) {
  const context = inferContrastContext(summary);

  if (context === 'hero' || context === 'heading') {
    return 'Oscurecer la imagen o video con un overlay, o cambiar el color del texto a uno con mas contraste. Si el fondo cambia por slide, validar cada slide por separado.';
  }

  if (context === 'button') {
    return 'Ajustar el color del texto o el relleno del boton hasta que la CTA se lea claramente en estado normal y hover.';
  }

  if (context === 'link') {
    return 'Cambiar el color del enlace o del fondo contenedor para que el enlace se lea sin esfuerzo.';
  }

  return 'Separar mas el color del texto del fondo o colocar el texto sobre un fondo mas solido para que la lectura sea inmediata.';
}

function buildNodeSummary(node, ruleId) {
  const { ratio, min } = extractContrastDetails(node);
  const scenarioLabels = getScenarioLabels(node);

  const parts = [
    `Clase: ${node.metadata.className}`,
    `Etiqueta HTML: ${node.metadata.tagName || getTagFromHtml(node.html)}`,
    `Padre cercano: ${node.metadata.nearestParent || '(sin padre con id/clase)'}`,
  ];

  if (scenarioLabels.length > 0) {
    parts.push(`Escenarios: ${scenarioLabels.join(', ')}`);
  }

  if (node.html) {
    parts.push(`HTML: ${shortenText(node.html.replace(/\s+/g, ' ').trim(), REPORT_HTML_SNIPPET_LIMIT)}`);
  }

  if (node.failureSummary) {
    parts.push(`Detalle tecnico: ${translateAxeSummary(node.failureSummary).replace(/\n/g, ' | ')}`);
  }

  if (ruleId === 'color-contrast') {
    parts.push(`Contraste: ${ratio} (Minimo requerido: ${min})`);
  }

  return parts.join(' | ');
}

function getReadableFailureSummaryLines(summary, ruleId) {
  if (!summary) {
    return [];
  }

  return translateAxeSummary(summary)
    .split('\n')
    .flatMap((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return [];
      }

      if (ruleId !== 'color-contrast') {
        return [trimmedLine];
      }

      return trimmedLine
        .replace(/\.\s+(Se esperaba una relacion de contraste de)/g, '.\n$1')
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean);
    });
}

function buildDetailedNodeSummary(node, ruleId, index) {
  const { ratio, min } = extractContrastDetails(node);
  const scenarioLabels = getScenarioLabels(node);
  const lines = [
    `  ${index + 1}.`,
    `     Clase: ${node.metadata.className}`,
    `     Etiqueta HTML: ${node.metadata.tagName || getTagFromHtml(node.html)}`,
    `     Padre cercano: ${node.metadata.nearestParent || '(sin padre con id/clase)'}`,
  ];

  if (scenarioLabels.length > 0) {
    lines.push(`     Escenarios: ${scenarioLabels.join(', ')}`);
  }

  if (node.html) {
    lines.push(`     HTML: ${shortenText(node.html.replace(/\s+/g, ' ').trim(), REPORT_HTML_SNIPPET_LIMIT)}`);
  }

  const failureSummaryLines = getReadableFailureSummaryLines(node.failureSummary, ruleId);

  if (failureSummaryLines.length > 0) {
    lines.push('     Detalle tecnico:');
    lines.push(...failureSummaryLines.map((line) => `       - ${line}`));
  }

  if (ruleId === 'color-contrast') {
    lines.push(`     Contraste: ${ratio}`);
    lines.push(`     Minimo requerido: ${min}`);
  }

  return lines.join('\n');
}

function buildNodeSample(node, ruleId, index) {
  if (ruleId === 'color-contrast') {
    return buildDetailedNodeSummary(node, ruleId, index);
  }

  return `  ${index + 1}. ${buildNodeSummary(node, ruleId)}`;
}

async function enrichViolations(page, violations) {
  const enrichedViolations = [];

  for (const violation of violations) {
    const enrichedNodes = [];

    for (const node of violation.nodes) {
      const fallbackSelector = node.target && node.target.length > 0 ? node.target[0] : '(without selector)';
      const metadata = await getElementMetadata(page, fallbackSelector);

      enrichedNodes.push({
        ...node,
        metadata,
      });
    }

    enrichedViolations.push({
      ...violation,
      nodes: enrichedNodes,
    });
  }

  return enrichedViolations;
}

async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    return;
  } catch (networkIdleError) {
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  }
}

async function dismissVisibleBlockingOverlays(page, timeoutMs = DEFAULT_MODAL_DISMISS_TIMEOUT_MS) {
  const pollIntervalMs = 500;
  const deadline = Date.now() + Math.max(0, timeoutMs);

  do {
    const dismissalResult = await page.evaluate(() => {
      const overlaySelectors = [
        'dialog[open]',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[data-modal]',
        '[data-popup]',
        '[id*="modal"]',
        '[id*="popup"]',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="popup"]',
        '[class*="Popup"]',
        '[class*="newsletter"]',
        '[class*="Newsletter"]',
      ].join(', ');
      const closeSelectors = [
        'button[aria-label*="close" i]',
        'button[aria-label*="cerrar" i]',
        'button[title*="close" i]',
        'button[title*="cerrar" i]',
        '[data-close]',
        '[data-dismiss]',
        '[data-modal-close]',
        '[class*="close"]',
        '[class*="Close"]',
        '[aria-label="Close"]',
        '[aria-label="Cerrar"]',
      ].join(', ');
      const isVisible = (element) => {
        if (!element || !(element instanceof HTMLElement)) {
          return false;
        }

        if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const looksBlocking = (element) => {
        if (!isVisible(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const zIndex = Number(style.zIndex || '0');
        const coversLargeArea = rect.width >= (window.innerWidth * 0.25) || rect.height >= (window.innerHeight * 0.2);
        const fixedLike = style.position === 'fixed' || style.position === 'sticky';

        return element.matches('dialog[open], [role="dialog"], [aria-modal="true"]')
          || fixedLike
          || zIndex >= 20
          || coversLargeArea;
      };

      const clicked = [];
      const overlays = Array.from(document.querySelectorAll(overlaySelectors))
        .filter((element) => looksBlocking(element));

      for (const overlay of overlays) {
        const closeControl = overlay.matches(closeSelectors)
          ? overlay
          : overlay.querySelector(closeSelectors);

        if (!closeControl || !isVisible(closeControl)) {
          continue;
        }

        closeControl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (typeof closeControl.click === 'function') {
          closeControl.click();
        }

        clicked.push(closeControl.getAttribute('aria-label') || closeControl.textContent || closeControl.className || 'close');
      }

      return {
        dismissedCount: clicked.length,
        hasBlockingOverlay: overlays.length > 0,
      };
    }).catch(() => ({ dismissedCount: 0, hasBlockingOverlay: false }));

    if (dismissalResult.dismissedCount > 0) {
      await page.waitForTimeout(250).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      continue;
    }

    await page.keyboard.press('Escape').catch(() => {});

    if (Date.now() >= deadline) {
      break;
    }

    await page.waitForTimeout(pollIntervalMs).catch(() => {});
  } while (Date.now() <= deadline);
}

async function preparePageForAudit(page) {
  await sleep(PREPARE_PAGE_DELAY_MS);
  await dismissVisibleBlockingOverlays(page);

  await page.evaluate(async ({ scrollStepPx, scrollIntervalMs }) => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = scrollStepPx;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, scrollIntervalMs);
    });
  }, {
    scrollStepPx: DEFAULT_SCROLL_STEP_PX,
    scrollIntervalMs: DEFAULT_SCROLL_INTERVAL_MS,
  });

  await dismissVisibleBlockingOverlays(page, 1500);
}

async function discoverInteractiveScenarios(page) {
  if (MAX_INTERACTIVE_SCENARIOS === 0) {
    return [];
  }

  const candidates = await page.evaluate((limit) => {
    const keywordList = ['menu', 'nav', 'cart', 'drawer', 'modal', 'dialog', 'accordion', 'toggle', 'tab', 'thumb', 'dot', 'carousel', 'filter', 'search'];
    const sanitize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const shorten = (value, maxLength) => (value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value);
    const isVisible = (element) => {
      if (!element || !(element instanceof HTMLElement)) {
        return false;
      }

      if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buildSelector = (element) => {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const pathParts = [];
      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let part = current.tagName.toLowerCase();

        if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).map((className) => CSS.escape(className)).join('.')}`;
        }

        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : [];

        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }

        pathParts.unshift(part);
        current = current.parentElement;
      }

      return pathParts.join(' > ');
    };
    const inferKind = (element, descriptorText) => {
      const role = (element.getAttribute('role') || '').toLowerCase();
      if (role === 'tab') {
        return 'tab';
      }

      if (element.tagName.toLowerCase() === 'summary') {
        return 'summary';
      }

      return keywordList.find((keyword) => descriptorText.includes(keyword)) || 'toggle';
    };
    const rawCandidates = Array.from(document.querySelectorAll('summary, button, [role="button"], [role="tab"], [data-toggle], [data-drawer], [data-modal], [aria-controls], [aria-expanded], [aria-haspopup]'));
    const selected = [];
    const seenSelectors = new Set();

    for (const element of rawCandidates) {
      if (!isVisible(element)) {
        continue;
      }

      const descriptorText = sanitize([
        element.id,
        element.className,
        element.getAttribute('aria-label'),
        element.getAttribute('data-toggle'),
        element.getAttribute('data-drawer'),
        element.getAttribute('data-modal'),
        element.textContent,
      ].filter(Boolean).join(' ')).toLowerCase();
      const strongCandidate = element.hasAttribute('aria-controls')
        || element.hasAttribute('aria-expanded')
        || element.hasAttribute('aria-haspopup')
        || element.tagName.toLowerCase() === 'summary'
        || (element.getAttribute('role') || '').toLowerCase() === 'tab';

      if (!strongCandidate && !keywordList.some((keyword) => descriptorText.includes(keyword))) {
        continue;
      }

      const selector = buildSelector(element);
      if (!selector || seenSelectors.has(selector)) {
        continue;
      }

      seenSelectors.add(selector);
      const kind = inferKind(element, descriptorText);
      const rawLabel = sanitize(element.getAttribute('aria-label') || element.textContent || element.id || element.className || kind || element.tagName.toLowerCase());

      selected.push({
        selector,
        label: `${kind}: ${shorten(rawLabel || kind, 60)}`,
      });

      if (selected.length >= limit) {
        break;
      }
    }

    return selected;
  }, INTERACTION_DISCOVERY_LIMIT);

  return candidates
    .slice(0, MAX_INTERACTIVE_SCENARIOS)
    .map((candidate, index) => ({
      id: `interactive-${index + 1}`,
      label: candidate.label,
      selector: candidate.selector,
    }));
}

async function runAxeAnalysis(page) {
  let axeBuilder = new AxeBuilder({ page });

  if (SELECTED_RULES) {
    axeBuilder = axeBuilder.withRules(SELECTED_RULES);
  }

  const results = await axeBuilder.analyze();

  return SELECTED_RULES
    ? (results.violations || []).filter((violation) => SELECTED_RULES.includes(violation.id))
    : (results.violations || []);
}

function attachScenarioLabels(violations, scenarioLabel) {
  return violations.map((violation) => ({
    ...violation,
    nodes: violation.nodes.map((node) => ({
      ...node,
      scenarioLabels: uniqueValues([...(node.scenarioLabels || []), scenarioLabel]),
    })),
  }));
}

function mergeScenarioResults(scenarioRuns) {
  const mergedViolations = new Map();
  const referenceResults = scenarioRuns[0] ? scenarioRuns[0].results : {};

  for (const scenarioRun of scenarioRuns) {
    for (const violation of scenarioRun.violations) {
      if (!mergedViolations.has(violation.id)) {
        mergedViolations.set(violation.id, {
          ...violation,
          nodes: [],
          nodeMap: new Map(),
        });
      }

      const mergedViolation = mergedViolations.get(violation.id);

      for (const node of violation.nodes) {
        const fingerprint = buildNodeFingerprint(violation.id, node);
        const existingNode = mergedViolation.nodeMap.get(fingerprint);

        if (existingNode) {
          existingNode.scenarioLabels = uniqueValues([
            ...getScenarioLabels(existingNode),
            ...getScenarioLabels(node),
          ]);
          continue;
        }

        const mergedNode = {
          ...node,
          scenarioLabels: getScenarioLabels(node),
        };

        mergedViolation.nodeMap.set(fingerprint, mergedNode);
        mergedViolation.nodes.push(mergedNode);
      }
    }
  }

  const violations = sortViolations(
    [...mergedViolations.values()].map((violation) => {
      const { nodeMap, ...normalizedViolation } = violation;
      return normalizedViolation;
    }),
  );

  return {
    ...referenceResults,
    violations,
  };
}

async function executeScenario(browser, url, viewport, scenario) {
  const context = await browser.newContext(buildContextOptions(viewport));

  try {
    return await runWithTimeout(async () => {
      let currentStep = 'creando pagina';

      const page = await context.newPage();
      try {
        currentStep = 'abriendo URL';
        await navigateWithFallback(page, url);
        currentStep = 'preparando pagina';
        await preparePageForAudit(page);
        currentStep = 'aplicando escenario';
        await applyScenarioInteraction(page, scenario);
        currentStep = 'ejecutando axe-core';

        const results = await new AxeBuilder({ page }).analyze();
        const filteredViolations = SELECTED_RULES
          ? (results.violations || []).filter((violation) => SELECTED_RULES.includes(violation.id))
          : (results.violations || []);

        currentStep = 'enriqueciendo hallazgos';
        const enrichedViolations = await enrichViolations(page, filteredViolations);

        return {
          results,
          violations: attachScenarioLabels(enrichedViolations, buildScenarioLabel(viewport, scenario)),
          scenarioLabel: buildScenarioLabel(viewport, scenario),
        };
      } catch (error) {
        const errorMessage = error && error.message ? error.message : 'Error desconocido';
        throw new Error(`Fallo en ${currentStep}: ${errorMessage}`);
      }
    }, SCENARIO_TIMEOUT_MS, buildScenarioLabel(viewport, scenario));
  } finally {
    await context.close();
  }
}

async function buildCoveragePlan(browser, url, onViewportPlanned) {
  const coveragePlans = [];
  const totalViewports = AUDIT_VIEWPORTS.length;
  let completedViewports = 0;

  for (const viewport of AUDIT_VIEWPORTS) {
    const context = await browser.newContext(buildContextOptions(viewport));

    try {
      const page = await context.newPage();
      await navigateWithFallback(page, url);
      await preparePageForAudit(page);

      coveragePlans.push({
        viewport,
        scenarios: [
          { id: 'base', label: 'estado base' },
          ...await discoverInteractiveScenarios(page),
        ],
      });
      completedViewports += 1;

      if (onViewportPlanned) {
        onViewportPlanned({
          viewport,
          completedViewports,
          totalViewports,
        });
      }
    } finally {
      await context.close();
    }
  }

  return coveragePlans;
}

async function applyScenarioInteraction(page, scenario) {
  if (!scenario || !scenario.selector) {
    return;
  }

  const locator = page.locator(scenario.selector).first();
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  try {
    await locator.click({ timeout: 4000 });
  } catch (clickError) {
    await locator.click({ timeout: 4000, force: true });
  }

  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(INTERACTION_SETTLE_DELAY);
}

function findCoverageScenario(coveragePlans, scenarioLabel) {
  if (!scenarioLabel) {
    return null;
  }

  for (const coveragePlan of coveragePlans) {
    for (const scenario of coveragePlan.scenarios) {
      const candidateLabel = buildScenarioLabel(coveragePlan.viewport, scenario);

      if (candidateLabel === scenarioLabel) {
        return {
          viewport: coveragePlan.viewport,
          scenario,
          scenarioLabel: candidateLabel,
        };
      }
    }
  }

  return null;
}

function getDefaultContrastScenario(coveragePlans) {
  const desktopPlan = coveragePlans.find((coveragePlan) => coveragePlan.viewport.id === 'desktop') || coveragePlans[0];

  if (!desktopPlan) {
    return null;
  }

  const scenario = desktopPlan.scenarios.find((candidate) => candidate.id === 'base') || desktopPlan.scenarios[0];

  if (!scenario) {
    return null;
  }

  return {
    viewport: desktopPlan.viewport,
    scenario,
    scenarioLabel: buildScenarioLabel(desktopPlan.viewport, scenario),
  };
}

function selectPreferredScenarioLabel(scenarioLabels) {
  const normalizedLabels = uniqueValues(scenarioLabels || []);

  if (normalizedLabels.length === 0) {
    return '';
  }

  return normalizedLabels.find((label) => /\/ estado base$/i.test(label)) || normalizedLabels[0];
}

function buildContrastSlideSummary(sample) {
  if (sample.kind === 'axe') {
    const node = sample.node;
    const contrast = extractContrastDetails(node);
    const contrastSample = extractContrastSample(node);

    return {
      selector: (node.target && node.target[0]) || (node.metadata && node.metadata.fullSelector) || '',
      className: (node.metadata && node.metadata.className) || '(sin clase)',
      tagName: (node.metadata && node.metadata.tagName) || getTagFromHtml(node.html),
      nearestParent: (node.metadata && node.metadata.nearestParent) || '(sin padre con id/clase)',
      textSnippet: '',
      html: node.html || '',
      ratio: contrast.ratio,
      min: contrast.min,
      detail: translateAxeSummary(node.failureSummary || '').replace(/\n+/g, ' ').trim(),
      contrastSample,
      scenarioLabels: getScenarioLabels(node),
    };
  }

  const node = sample.node;
  const contrastSample = node.contrastSample || null;
  const ratio = contrastSample && contrastSample.ratio ? contrastSample.ratio : 'No disponible';
  const min = contrastSample
    ? contrastSample.largeText
      ? '3'
      : '4.5'
    : 'No disponible';

  return {
    selector: node.selector || '',
    className: (node.metadata && node.metadata.className) || '(sin clase)',
    tagName: (node.metadata && node.metadata.tagName) || '(sin etiqueta)',
    nearestParent: (node.metadata && node.metadata.nearestParent) || '(sin padre con id/clase)',
    textSnippet: node.textSnippet || '',
    html: node.html || '',
    ratio,
    min,
    detail: node.description || 'Contraste insuficiente',
    contrastSample,
    scenarioLabels: [],
  };
}

function selectContrastSlidesSamples(unifiedFindings) {
  const contrastFinding = unifiedFindings.find((finding) => finding.ruleId === 'color-contrast');

  if (!contrastFinding) {
    return {
      finding: null,
      samples: [],
    };
  }

  const waveNodeSamples = contrastFinding.samples.filter((sample) => sample.kind === 'wave-node');
  const axeSamples = contrastFinding.samples.filter((sample) => sample.kind === 'axe');

  return {
    finding: contrastFinding,
    samples: waveNodeSamples.length > 0 ? waveNodeSamples : axeSamples,
  };
}

function buildContrastSlideEntries(unifiedFindings, coveragePlans) {
  const { finding, samples } = selectContrastSlidesSamples(unifiedFindings);
  const defaultScenario = getDefaultContrastScenario(coveragePlans);

  if (!finding) {
    return {
      finding: null,
      entries: [],
    };
  }

  const entries = samples
    .map((sample, index) => {
      const summary = buildContrastSlideSummary(sample);
      const preferredScenario = findCoverageScenario(coveragePlans, selectPreferredScenarioLabel(summary.scenarioLabels));
      const resolvedScenario = preferredScenario || defaultScenario;

      return {
        id: `contrast-slide-${index + 1}`,
        sequence: index + 1,
        selector: summary.selector,
        className: summary.className,
        tagName: summary.tagName,
        nearestParent: summary.nearestParent,
        textSnippet: summary.textSnippet,
        html: summary.html,
        ratio: summary.ratio,
        min: summary.min,
        metricLabel: buildContrastMetricLabel(summary),
        detail: summary.detail,
        reason: buildContrastFailureReason(summary),
        clientSummary: buildContrastClientSummary(summary),
        actionPlan: buildContrastActionPlan(summary),
        scenarioLabel: resolvedScenario ? resolvedScenario.scenarioLabel : 'No disponible',
        viewportLabel: resolvedScenario ? resolvedScenario.viewport.label : 'No disponible',
        viewport: resolvedScenario ? resolvedScenario.viewport : null,
        scenario: resolvedScenario ? resolvedScenario.scenario : null,
      };
    })
    .filter((entry) => Boolean(entry.selector) && Boolean(entry.viewport) && Boolean(entry.scenario));

  return {
    finding,
    entries,
  };
}

async function clearContrastHighlight(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-smg-contrast-overlay]').forEach((element) => element.remove());
  }).catch(() => {});
}

async function captureContrastScreenshot(page, selector, badgeText) {
  await dismissVisibleBlockingOverlays(page, SCREENSHOT_MODAL_DISMISS_TIMEOUT_MS);

  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  }).catch(() => {});
  await page.waitForTimeout(150);

  const highlightInfo = await page.evaluate(({ targetSelector, targetBadgeText, highlightColor }) => {
    document.querySelectorAll('[data-smg-contrast-overlay]').forEach((element) => element.remove());

    const target = document.querySelector(targetSelector);

    if (!target) {
      return null;
    }

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = target.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      return null;
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('data-smg-contrast-overlay', 'outline');
    overlay.style.position = 'fixed';
    overlay.style.left = `${Math.max(rect.left - 6, 0)}px`;
    overlay.style.top = `${Math.max(rect.top - 6, 0)}px`;
    overlay.style.width = `${Math.max(rect.width + 12, 16)}px`;
    overlay.style.height = `${Math.max(rect.height + 12, 16)}px`;
    overlay.style.border = `4px solid ${highlightColor}`;
    overlay.style.borderRadius = '12px';
    overlay.style.boxShadow = `0 0 0 9999px rgba(12, 18, 28, 0.34), 0 0 0 10px rgba(255, 255, 255, 0.18)`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483646';

    const badge = document.createElement('div');
    badge.setAttribute('data-smg-contrast-overlay', 'badge');
    badge.textContent = targetBadgeText;
    badge.style.position = 'fixed';
    badge.style.left = `${Math.max(rect.left - 6, 12)}px`;
    badge.style.top = `${Math.max(rect.top - 46, 12)}px`;
    badge.style.padding = '8px 12px';
    badge.style.background = highlightColor;
    badge.style.color = '#fff';
    badge.style.fontSize = '14px';
    badge.style.fontWeight = '700';
    badge.style.borderRadius = '999px';
    badge.style.letterSpacing = '0.02em';
    badge.style.boxShadow = '0 10px 26px rgba(0, 0, 0, 0.32)';
    badge.style.pointerEvents = 'none';
    badge.style.zIndex = '2147483647';

    document.body.appendChild(overlay);
    document.body.appendChild(badge);

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }, {
    targetSelector: selector,
    targetBadgeText: badgeText,
    highlightColor: CONTRAST_HIGHLIGHT_COLOR,
  });

  if (!highlightInfo) {
    await clearContrastHighlight(page);
    throw new Error('No se encontro un elemento visible para este selector en el escenario capturado.');
  }

  await page.waitForTimeout(120);
  const overviewBuffer = await page.screenshot({
    type: CONTRAST_SCREENSHOT_TYPE,
    quality: CONTRAST_SCREENSHOT_QUALITY,
  });

  const clipPaddingX = 80;
  const clipPaddingY = 72;
  const clip = {
    x: Math.max(0, Math.floor(highlightInfo.x - clipPaddingX)),
    y: Math.max(0, Math.floor(highlightInfo.y - clipPaddingY)),
    width: Math.max(120, Math.min(highlightInfo.viewportWidth - Math.max(0, Math.floor(highlightInfo.x - clipPaddingX)), Math.ceil(highlightInfo.width + (clipPaddingX * 2)))),
    height: Math.max(120, Math.min(highlightInfo.viewportHeight - Math.max(0, Math.floor(highlightInfo.y - clipPaddingY)), Math.ceil(highlightInfo.height + (clipPaddingY * 2)))),
  };
  const focusBuffer = await page.screenshot({
    type: CONTRAST_SCREENSHOT_TYPE,
    quality: CONTRAST_ZOOM_SCREENSHOT_QUALITY,
    clip,
  }).catch(() => null);
  await clearContrastHighlight(page);

  return {
    overviewDataUrl: `data:image/${CONTRAST_SCREENSHOT_TYPE};base64,${overviewBuffer.toString('base64')}`,
    focusDataUrl: focusBuffer
      ? `data:image/${CONTRAST_SCREENSHOT_TYPE};base64,${focusBuffer.toString('base64')}`
      : '',
  };
}

async function captureContrastSlideDeck(browser, url, coveragePlans, unifiedFindings) {
  const { finding, entries } = buildContrastSlideEntries(unifiedFindings, coveragePlans);

  if (!finding || entries.length === 0) {
    return {
      finding,
      entries: [],
      capturedCount: 0,
      totalCount: 0,
      fileName: CONTRAST_SLIDES_FILE_NAME,
    };
  }

  const scenarioSessions = new Map();

  try {
    for (const entry of entries) {
      const sessionKey = `${entry.viewport.id}::${entry.scenario.id}`;
      let session = scenarioSessions.get(sessionKey);

      if (!session) {
        const context = await browser.newContext(buildContextOptions(entry.viewport));
        const page = await context.newPage();
        await navigateWithFallback(page, url);
        await preparePageForAudit(page);
        await applyScenarioInteraction(page, entry.scenario);

        session = { context, page };
        scenarioSessions.set(sessionKey, session);
      }

      const capture = await captureContrastScreenshot(session.page, entry.selector, `Contraste ${entry.sequence}`)
        .catch((error) => {
          entry.captureError = error && error.message
            ? error.message
            : 'Fallo desconocido generando la captura.';

          return null;
        });

      entry.overviewDataUrl = capture ? capture.overviewDataUrl : '';
      entry.focusDataUrl = capture ? capture.focusDataUrl : '';
      entry.captureStatus = capture ? 'ok' : 'failed';
    }
  } finally {
    for (const session of scenarioSessions.values()) {
      await clearContrastHighlight(session.page);
      await session.context.close().catch(() => {});
    }
  }

  return {
    finding,
    entries,
    capturedCount: entries.filter((entry) => Boolean(entry.overviewDataUrl)).length,
    totalCount: entries.length,
    fileName: CONTRAST_SLIDES_FILE_NAME,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarizeCaptureFailures(entries) {
  const failedEntries = (entries || []).filter((entry) => !entry.overviewDataUrl);

  if (failedEntries.length === 0) {
    return 'Todas las capturas se generaron correctamente.';
  }

  const failureCounts = failedEntries.reduce((accumulator, entry) => {
    const reason = entry.captureError || 'Fallo desconocido generando la captura.';
    accumulator.set(reason, (accumulator.get(reason) || 0) + 1);
    return accumulator;
  }, new Map());

  return Array.from(failureCounts.entries())
    .map(([reason, count]) => `${count} sin captura: ${reason}`)
    .join(' | ');
}

function buildContrastSlidesHtml(url, axeJson, unifiedFindings) {
  const contrastFinding = unifiedFindings.find((finding) => finding.ruleId === 'color-contrast') || null;
  const contrastSlides = axeJson.contrastSlides || {
    entries: [],
    capturedCount: 0,
    totalCount: 0,
  };
  const pageVisibility = axeJson.pageVisibility || null;
  const slideEntries = contrastSlides.entries || [];
  const captureFailureSummary = summarizeCaptureFailures(slideEntries);
  const summarySlide = `
    <section class="slide active slide--intro">
      <div class="eyebrow">Solo Media Group · Contraste</div>
      <h1>Errores de contraste detectados</h1>
      <p class="lede">Reporte visual para cliente con cada hallazgo marcado sobre la pagina.</p>
      <div class="stats-grid">
        <article class="stat-card">
          <span>Total hallazgos</span>
          <strong>${contrastFinding ? contrastFinding.count : 0}</strong>
        </article>
        <article class="stat-card">
          <span>Capturas generadas</span>
          <strong>${contrastSlides.capturedCount}/${contrastSlides.totalCount}</strong>
        </article>
        <article class="stat-card">
          <span>Visibilidad</span>
          <strong>${escapeHtml(formatPageVisibility(pageVisibility))}</strong>
        </article>
      </div>
      <dl class="summary-list">
        <div><dt>URL</dt><dd>${escapeHtml(url)}</dd></div>
        <div><dt>Resumen</dt><dd>${escapeHtml(contrastFinding ? contrastFinding.summaryLabel : 'Sin errores de contraste')}</dd></div>
        <div><dt>Capturas faltantes</dt><dd>${escapeHtml(captureFailureSummary)}</dd></div>
        <div><dt>Fecha</dt><dd>${escapeHtml(new Date().toLocaleString('es-ES'))}</dd></div>
      </dl>
    </section>`;
  const issueSlides = slideEntries.length > 0
    ? slideEntries.map((entry) => `
      <section class="slide">
        <div class="eyebrow">Hallazgo ${entry.sequence} de ${slideEntries.length}</div>
        <h2>${escapeHtml(entry.textSnippet || entry.className || entry.tagName || 'Contraste insuficiente')}</h2>
        <div class="meta-row">
          <span>Escenario: ${escapeHtml(entry.scenarioLabel)}</span>
          <span>Clase: ${escapeHtml(entry.className)}</span>
          <span>Etiqueta: ${escapeHtml(entry.tagName)}</span>
        </div>
        <div class="meta-row meta-row--secondary">
          <span>Padre cercano: ${escapeHtml(entry.nearestParent)}</span>
          <span>${escapeHtml(entry.metricLabel)}</span>
        </div>
        <div class="visual-grid">
          <figure class="visual-card visual-card--context">
            <figcaption>Vista en pagina</figcaption>
            ${entry.overviewDataUrl
              ? `<img src="${entry.overviewDataUrl}" alt="Captura del hallazgo ${entry.sequence}">`
              : `<div class="visual-empty">No se pudo generar la captura de contexto para este hallazgo.<br>${escapeHtml(entry.captureError || 'Sin detalle disponible.')}</div>`}
          </figure>
          <figure class="visual-card visual-card--focus">
            <figcaption>Zoom del area afectada</figcaption>
            ${entry.focusDataUrl
              ? `<img src="${entry.focusDataUrl}" alt="Zoom del hallazgo ${entry.sequence}">`
              : '<div class="visual-empty">No se pudo generar el zoom para este hallazgo.</div>'}
          </figure>
        </div>
        <div class="issue-summary-grid">
          <article class="detail-card issue-summary-card">
            <span class="issue-summary-card__label">Que esta mal</span>
            <p>${escapeHtml(entry.clientSummary)}</p>
          </article>
          <article class="detail-card issue-summary-card">
            <span class="issue-summary-card__label">Que hacer</span>
            <p>${escapeHtml(entry.actionPlan)}</p>
          </article>
          <article class="detail-card issue-summary-card">
            <span class="issue-summary-card__label">Detalle tecnico</span>
            <p>${escapeHtml(entry.reason || entry.detail || 'Aumentar la diferencia visual entre el color del texto y el fondo.')}</p>
          </article>
        </div>
        <dl class="summary-list summary-list--issue">
          <div><dt>Escenario</dt><dd>${escapeHtml(entry.scenarioLabel)}</dd></div>
          <div><dt>Ubicacion</dt><dd>${escapeHtml(entry.nearestParent)}</dd></div>
          <div><dt>Contraste</dt><dd>${escapeHtml(entry.metricLabel)}</dd></div>
          <div><dt>Captura</dt><dd>${escapeHtml(entry.captureError ? `No se pudo capturar: ${entry.captureError}` : 'Captura generada correctamente.')}</dd></div>
        </dl>
        <div class="detail-grid detail-grid--supporting">
          <article class="detail-card">
            <h3>HTML cercano</h3>
            <pre>${escapeHtml(shortenText((entry.html || '').replace(/\s+/g, ' ').trim(), 380) || 'No disponible')}</pre>
          </article>
        </div>
      </section>`).join('')
    : `
      <section class="slide">
        <div class="eyebrow">Resultado</div>
        <h2>Sin errores de contraste</h2>
        <p class="lede">Esta ejecucion no encontro elementos con contraste insuficiente.</p>
      </section>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMG Accessibility Contrast Slides</title>
  <style>
    :root {
      --bg: #0f1724;
      --panel: #152134;
      --panel-strong: #0c1422;
      --ink: #ecf2ff;
      --muted: #98a7c2;
      --accent: #41d3a2;
      --danger: ${CONTRAST_HIGHLIGHT_COLOR};
      --border: rgba(255, 255, 255, 0.12);
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at top right, rgba(65, 211, 162, 0.16), transparent 28%),
        radial-gradient(circle at top left, rgba(255, 90, 54, 0.12), transparent 24%),
        linear-gradient(180deg, #0a1220 0%, var(--bg) 100%);
      color: var(--ink);
    }
    .deck-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 18px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(10, 18, 32, 0.82);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(14px);
      z-index: 10;
    }
    .deck-title {
      font-size: 0.95rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }
    .deck-counter { color: var(--muted); font-size: 0.92rem; }
    .slide {
      display: none;
      min-height: 100vh;
      padding: 110px 44px 100px;
    }
    .slide.active { display: block; }
    .slide--intro { display: block; }
    .eyebrow {
      display: inline-flex;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(65, 211, 162, 0.12);
      color: var(--accent);
      font-size: 0.84rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
    h1, h2, h3 { margin: 0 0 14px; }
    h1 { font-size: clamp(2.3rem, 6vw, 4.4rem); max-width: 12ch; }
    h2 { font-size: clamp(1.8rem, 4vw, 3rem); max-width: 18ch; }
    h3 { font-size: 1rem; color: var(--accent); }
    .lede {
      max-width: 60ch;
      color: var(--muted);
      font-size: 1.08rem;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .stats-grid, .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .stat-card, .detail-card {
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 22px;
      box-shadow: var(--shadow);
    }
    .stat-card span {
      display: block;
      color: var(--muted);
      font-size: 0.95rem;
      margin-bottom: 10px;
    }
    .stat-card strong {
      font-size: clamp(1.9rem, 5vw, 3.2rem);
      line-height: 1;
    }
    .summary-list {
      margin: 28px 0 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .summary-list div {
      background: rgba(12, 20, 34, 0.72);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
    }
    .summary-list dt {
      color: var(--muted);
      margin-bottom: 8px;
      font-size: 0.92rem;
    }
    .summary-list dd {
      margin: 0;
      word-break: break-word;
      line-height: 1.5;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .meta-row span {
      border: 1px solid rgba(65, 211, 162, 0.22);
      background: rgba(65, 211, 162, 0.08);
      color: #d9fff2;
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 0.92rem;
      line-height: 1.35;
    }
    .meta-row--secondary span {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border);
      color: var(--ink);
    }
    .visual-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 18px;
      margin: 24px 0;
    }
    .visual-card {
      margin: 0;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .visual-card figcaption {
      font-size: 0.92rem;
      color: var(--muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .visual-card img {
      width: 100%;
      display: block;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: #060b14;
    }
    .visual-empty {
      min-height: 220px;
      border-radius: 16px;
      border: 1px dashed rgba(255,255,255,0.18);
      display: grid;
      place-items: center;
      color: var(--muted);
      padding: 24px;
      text-align: center;
    }
    .issue-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin: 0 0 24px;
    }
    .issue-summary-card {
      min-height: 100%;
    }
    .issue-summary-card__label {
      display: block;
      color: var(--muted);
      font-size: 0.95rem;
      margin-bottom: 10px;
    }
    .summary-list--issue {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin: 0 0 24px;
    }
    .detail-grid--supporting {
      grid-template-columns: 1fr;
    }
    .detail-card p, .detail-card pre {
      margin: 0;
      color: var(--ink);
      line-height: 1.6;
    }
    .detail-card pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: Consolas, monospace;
      font-size: 0.88rem;
      background: var(--panel-strong);
      border-radius: 14px;
      padding: 16px;
      margin-top: 12px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .deck-nav {
      position: fixed;
      right: 28px;
      bottom: 26px;
      display: flex;
      gap: 12px;
      z-index: 10;
    }
    .deck-nav button {
      border: none;
      border-radius: 999px;
      padding: 14px 20px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      background: var(--accent);
      color: #062417;
    }
    .deck-nav button:disabled {
      cursor: not-allowed;
      background: #3d4a5f;
      color: #93a0b4;
    }
    @media (max-width: 960px) {
      .slide { padding: 98px 18px 110px; }
      .stats-grid, .detail-grid, .summary-list, .visual-grid, .issue-summary-grid { grid-template-columns: 1fr; }
      .deck-header { padding: 16px 18px; }
      .deck-nav { left: 18px; right: 18px; justify-content: space-between; }
      .deck-nav button { width: calc(50% - 6px); }
    }
  </style>
</head>
<body>
  <header class="deck-header">
    <div class="deck-title">SMG Accessibility Slides</div>
    <div class="deck-counter"><span id="deck-counter">1 / ${slideEntries.length + 1}</span></div>
  </header>
  ${summarySlide}
  ${issueSlides}
  <nav class="deck-nav">
    <button id="prev-slide">Anterior</button>
    <button id="next-slide">Siguiente</button>
  </nav>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'));
    let currentSlide = 0;
    const counter = document.getElementById('deck-counter');
    const prevButton = document.getElementById('prev-slide');
    const nextButton = document.getElementById('next-slide');
    function updateDeck(index) {
      slides.forEach((slide, slideIndex) => {
        slide.classList.toggle('active', slideIndex === index);
      });
      counter.textContent = (index + 1) + ' / ' + slides.length;
      prevButton.disabled = index === 0;
      nextButton.disabled = index === slides.length - 1;
    }
    prevButton.addEventListener('click', () => {
      if (currentSlide > 0) {
        currentSlide -= 1;
        updateDeck(currentSlide);
      }
    });
    nextButton.addEventListener('click', () => {
      if (currentSlide < slides.length - 1) {
        currentSlide += 1;
        updateDeck(currentSlide);
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        nextButton.click();
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        prevButton.click();
      }
    });
    updateDeck(currentSlide);
  </script>
</body>
</html>`;
}

async function runAudit(url) {
  logAuditProgress(0, 'Iniciando auditoria');
  logAuditProgress(5, 'Detectando visibilidad de la pagina');
  const pageVisibility = await detectPageVisibility(url);
  logAuditProgress(10, `Visibilidad detectada: ${pageVisibility.visibility}`);
  logAuditProgress(15, 'Abriendo navegador para auditoria');
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    logAuditProgress(20, 'Construyendo plan de cobertura');
    const coveragePlans = await buildCoveragePlan(browser, url, ({ viewport, completedViewports, totalViewports }) => {
      const progressPercent = 20 + ((completedViewports / totalViewports) * 10);
      logAuditProgress(progressPercent, `Cobertura lista para ${viewport.label}`);
    });
    const totalScenarios = coveragePlans.reduce((sum, plan) => sum + plan.scenarios.length, 0);
    const scenarioRuns = [];
    const skippedScenarios = [];
    let completedScenarios = 0;

    if (totalScenarios === 0) {
      logAuditProgress(80, 'No se detectaron escenarios para ejecutar');
    }

    for (const plan of coveragePlans) {
      for (const scenario of plan.scenarios) {
        completedScenarios += 1;
        const scenarioProgress = 30 + ((completedScenarios / totalScenarios) * 50);
        logAuditProgress(
          scenarioProgress,
          `Escenario ${completedScenarios}/${totalScenarios}: ${buildScenarioLabel(plan.viewport, scenario)}`,
        );

        try {
          const scenarioRun = await executeScenario(browser, url, plan.viewport, scenario);
          scenarioRuns.push(scenarioRun);
        } catch (error) {
          const scenarioLabel = buildScenarioLabel(plan.viewport, scenario);
          const errorMessage = error && error.message ? error.message : 'Error desconocido';
          skippedScenarios.push(`${scenarioLabel} (${errorMessage})`);
          console.warn(`Escenario omitido: ${scenarioLabel} (${errorMessage})`);
        }
      }
    }

    logAuditProgress(85, 'Consolidando resultados de axe-core');
    const mergedResults = mergeScenarioResults(scenarioRuns);
    logAuditProgress(92, 'Ejecutando integracion WAVE');
    const wave = await runWaveAnalysis(url, pageVisibility);
    const unifiedFindings = collectUnifiedFindings(mergedResults.violations || [], wave);
    logAuditProgress(96, 'Generando capturas visuales de contraste');
    const contrastSlides = await captureContrastSlideDeck(browser, url, coveragePlans, unifiedFindings);
    logAuditProgress(98, 'Generando reporte final');

    return {
      ...mergedResults,
      pageVisibility,
      wave,
      contrastSlides,
      coverage: {
        viewports: AUDIT_VIEWPORTS.map(buildViewportSummary),
        scenarios: scenarioRuns.map((scenarioRun) => scenarioRun.scenarioLabel),
        skippedScenarios,
      },
    };
  } finally {
    await browser.close();
  }
}

function formatPageVisibility(pageVisibility) {
  if (!pageVisibility) {
    return 'No disponible';
  }

  return `${pageVisibility.visibility} (${pageVisibility.reason})`;
}

function translateWaveStatus(status) {
  const labels = {
    ok: 'OK',
    error: 'ERROR',
    skipped: 'OMITIDO',
  };

  return labels[status] || status || 'No disponible';
}

function formatWaveCategorySummary(wave) {
  if (!wave || !wave.categories || wave.categories.length === 0) {
    return 'Categorias WAVE: ninguna';
  }

  return [
    'Categorias WAVE:',
    ...wave.categories.map((category) => `  - ${category.label}: ${category.count}`),
  ].join('\n');
}

function buildWaveDetailLines(waveItem, index) {
  const lines = [
    `  ${index + 1}. ${waveItem.description} (${waveItem.count})`,
  ];
  const hasSampleNodes = waveItem.sampleNodes && waveItem.sampleNodes.length > 0;

  if (waveItem.itemId) {
    lines.push(`     ID WAVE: ${waveItem.itemId}`);
  }

  if (waveItem.selectors && waveItem.selectors.length > 0) {
    lines.push(`     Selectores: ${waveItem.selectors.slice(0, 5).join(' | ')}`);
  }

  if (waveItem.xpaths && waveItem.xpaths.length > 0) {
    lines.push(`     XPath: ${waveItem.xpaths.slice(0, 3).join(' | ')}`);
  }

  if (waveItem.contrastSamples && waveItem.contrastSamples.length > 0) {
    lines.push('     Muestras de contraste:');
    lines.push(...waveItem.contrastSamples.map((sample) => `       - Ratio ${sample.ratio} | FG ${sample.foreground} | BG ${sample.background} | Large text: ${sample.largeText}`));
  }

  if (!hasSampleNodes && waveItem.sampleAlts && waveItem.sampleAlts.length > 0) {
    lines.push('     Muestras WAVE:');
    lines.push(...waveItem.sampleAlts.map((sample) => `       - ${buildWaveSampleLabel(sample, waveItem.description)}`));
  }

  if (hasSampleNodes) {
    lines.push(`     Total elementos detectados por WAVE: ${waveItem.sampleNodes.length}`);
    lines.push('     Elementos detectados por WAVE:');
    lines.push(...waveItem.sampleNodes.map((sampleNode, sampleIndex) => [
      `       ${sampleIndex + 1}.`,
      `          Clase: ${sampleNode.metadata.className}`,
      `          Etiqueta HTML: ${sampleNode.metadata.tagName}`,
      `          Padre cercano: ${sampleNode.metadata.nearestParent}`,
      sampleNode.metadata.nearestParentHtml ? `          HTML padre cercano: ${shortenText(sampleNode.metadata.nearestParentHtml, REPORT_HTML_SNIPPET_LIMIT)}` : null,
      sampleNode.selector ? `          Selector: ${sampleNode.selector}` : null,
      sampleNode.textSnippet ? `          Texto: ${shortenText(sampleNode.textSnippet, REPORT_HTML_SNIPPET_LIMIT)}` : null,
      sampleNode.html ? `          HTML: ${shortenText(sampleNode.html, REPORT_HTML_SNIPPET_LIMIT)}` : null,
    ].filter(Boolean).join('\n')));
  }

  return lines.join('\n');
}

function slugifyRuleLabel(value, fallbackPrefix) {
  const normalizedValue = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalizedValue || `${fallbackPrefix || 'rule'}-unknown`;
}

function resolveWaveUnifiedRule(waveItem) {
  const normalizedDescription = normalizeWaveItemLabel(waveItem.description || '');

  if (waveItem.itemId === 'alt_missing' || normalizedDescription.includes('missing alternative text')) {
    return {
      ruleId: 'image-alt',
      summaryLabel: 'Missing alternative text',
    };
  }

  if (waveItem.itemId === 'link_empty' || normalizedDescription.includes('empty link')) {
    return {
      ruleId: 'link-name',
      summaryLabel: 'Empty link',
    };
  }

  if (waveItem.categoryId === 'contrast' || normalizedDescription.includes('contrast')) {
    return {
      ruleId: 'color-contrast',
      summaryLabel: waveItem.description || 'Very low contrast',
    };
  }

  return {
    ruleId: slugifyRuleLabel(waveItem.itemId || waveItem.description, waveItem.categoryId || 'wave'),
    summaryLabel: waveItem.description || waveItem.itemId || 'Hallazgo WAVE',
  };
}

function buildWaveNodeSummary(sampleNode) {
  const parts = [
    `Clase: ${sampleNode.metadata.className}`,
    `Etiqueta HTML: ${sampleNode.metadata.tagName}`,
    `Padre cercano: ${sampleNode.metadata.nearestParent}`,
  ];

  if (sampleNode.textSnippet) {
    parts.push(`Texto: ${shortenText(sampleNode.textSnippet, REPORT_HTML_SNIPPET_LIMIT)}`);
  }

  if (sampleNode.html) {
    parts.push(`HTML: ${shortenText(sampleNode.html, REPORT_HTML_SNIPPET_LIMIT)}`);
  }

  return parts.join(' | ');
}

function buildUnifiedSampleFingerprint(ruleId, correctionType, sample) {
  if (sample.kind === 'axe') {
    return buildNodeFingerprint(ruleId, sample.node);
  }

  if (sample.kind === 'wave-node') {
    const metadata = sample.node.metadata || {};

    return [
      ruleId,
      metadata.className,
      metadata.tagName,
      metadata.nearestParent,
      sample.node.selector,
      sample.node.textSnippet,
      sample.node.html,
    ].join('::');
  }

  return `${ruleId}::${sample.label || 'sample'}`;
}

function buildUnifiedSampleLine(sample, ruleId, index) {
  if (sample.kind === 'axe') {
    return `  ${index + 1}. ${buildNodeSummary(sample.node, ruleId)}`;
  }

  if (sample.kind === 'wave-node') {
    return `  ${index + 1}. ${buildWaveNodeSummary(sample.node)}`;
  }

  return `  ${index + 1}. ${sample.label || 'Muestra disponible'}`;
}

function compareUnifiedFindings(leftFinding, rightFinding) {
  if (leftFinding.correctionType !== rightFinding.correctionType) {
    return leftFinding.correctionType === 'autofix' ? -1 : 1;
  }

  const leftPriority = REPORT_PRIORITY_RULES.indexOf(leftFinding.ruleId);
  const rightPriority = REPORT_PRIORITY_RULES.indexOf(rightFinding.ruleId);
  const normalizedLeftPriority = leftPriority === -1 ? REPORT_PRIORITY_RULES.length : leftPriority;
  const normalizedRightPriority = rightPriority === -1 ? REPORT_PRIORITY_RULES.length : rightPriority;

  if (normalizedLeftPriority !== normalizedRightPriority) {
    return normalizedLeftPriority - normalizedRightPriority;
  }

  return leftFinding.ruleId.localeCompare(rightFinding.ruleId);
}

function collectUnifiedFindings(violations, wave) {
  const findingsByRule = new Map();
  const detailedWaveItems = (wave && wave.items ? wave.items : [])
    .filter((item) => WAVE_DETAILED_CATEGORIES.has(item.categoryId));

  const ensureFinding = (ruleId, summaryLabel, correctionType) => {
    if (!findingsByRule.has(ruleId)) {
      findingsByRule.set(ruleId, {
        ruleId,
        summaryLabels: new Set(summaryLabel ? [summaryLabel] : []),
        correctionType,
        count: 0,
        samples: [],
      });
    }

    const finding = findingsByRule.get(ruleId);

    if (summaryLabel) {
      finding.summaryLabels.add(summaryLabel);
    }

    if (correctionType === 'autofix') {
      finding.correctionType = 'autofix';
    }

    return finding;
  };

  for (const violation of violations) {
    const finding = ensureFinding(violation.id, violation.help || violation.id, getFixStrategy(violation.id));
    finding.count = Math.max(finding.count, violation.nodes.length);

    for (const node of violation.nodes) {
      finding.samples.push({
        kind: 'axe',
        node,
      });
    }
  }

  for (const waveItem of detailedWaveItems) {
    const resolvedRule = resolveWaveUnifiedRule(waveItem);
    const correctionType = getFixStrategy(resolvedRule.ruleId);
    const finding = ensureFinding(resolvedRule.ruleId, resolvedRule.summaryLabel, correctionType);
    const waveItemCount = waveItem.sampleNodes && waveItem.sampleNodes.length > 0
      ? waveItem.sampleNodes.length
      : Number(waveItem.count || 0);

    finding.count = Math.max(finding.count, waveItemCount);

    if (waveItem.sampleNodes && waveItem.sampleNodes.length > 0) {
      for (const sampleNode of waveItem.sampleNodes) {
        finding.samples.push({
          kind: 'wave-node',
          node: sampleNode,
        });
      }

      if (waveItem.sampleAlts && waveItem.sampleAlts.length > 0) {
        for (const [sampleAltIndex, sampleAlt] of waveItem.sampleAlts.entries()) {
          finding.samples.push({
            kind: 'wave-label',
            label: buildWaveSampleLabel(sampleAlt, resolvedRule.summaryLabel),
            index: sampleAltIndex,
          });
        }
      }
    } else if (waveItem.sampleAlts && waveItem.sampleAlts.length > 0) {
      for (const sampleAlt of waveItem.sampleAlts) {
        finding.samples.push({
          kind: 'wave-label',
          label: buildWaveSampleLabel(sampleAlt, resolvedRule.summaryLabel),
        });
      }
    }
  }

  return [...findingsByRule.values()]
    .map((finding) => {
      const uniqueSamples = [];
      const fingerprints = new Set();

      for (const sample of finding.samples) {
        const fingerprint = buildUnifiedSampleFingerprint(finding.ruleId, finding.correctionType, sample);

        if (fingerprints.has(fingerprint)) {
          continue;
        }

        fingerprints.add(fingerprint);
        uniqueSamples.push(sample);
      }

      return {
        ...finding,
        summaryLabel: [...finding.summaryLabels][0] || finding.ruleId,
        samples: uniqueSamples,
      };
    })
    .sort(compareUnifiedFindings);
}

function buildUnifiedRuleList(label, findings) {
  if (!findings || findings.length === 0) {
    return `${label}: ninguno`;
  }

  return [
    `${label}:`,
    ...findings.map((finding) => `  - ${finding.ruleId} (${finding.count})`),
  ].join('\n');
}

function buildUnifiedFindingSection(finding) {
  const lines = [
    '------------------------',
    `Regla: ${finding.ruleId}`,
    `Tipo de correccion: ${finding.correctionType}`,
    `Estado de correccion: ${getFixStrategyLabel(finding.ruleId)}`,
    `Resumen: ${finding.summaryLabel}`,
    `Elementos afectados: ${finding.count}`,
  ];

  if (finding.samples.length > 0) {
    lines.push('Muestras:');
    lines.push(...finding.samples.map((sample, index) => buildUnifiedSampleLine(sample, finding.ruleId, index)));
  } else {
    lines.push('Muestras: ninguna');
  }

  return lines.join('\n');
}

function buildWaveReportSection(wave, pageVisibility) {
  if (!wave || wave.enabled === false) {
    return [
      '========================',
      '  Integracion WAVE',
      '========================',
      'Estado WAVE: DESACTIVADO',
      '',
    ].join('\n');
  }

  const detailedItems = (wave.items || []).filter((item) => WAVE_DETAILED_CATEGORIES.has(item.categoryId));
  const lines = [
    '========================',
    '  Integracion WAVE',
    '========================',
    `Estado WAVE: ${translateWaveStatus(wave.status)}`,
    `Estrategia solicitada: ${wave.requestedStrategy}`,
    `Fuente usada: ${wave.source}`,
    `Visibilidad detectada: ${formatPageVisibility(pageVisibility)}`,
    `URL analizada por WAVE: ${wave.analyzedUrl || 'No disponible'}`,
    wave.waveUrl ? `Reporte WAVE: ${wave.waveUrl}` : null,
    `Total de items WAVE: ${wave.counts.allItems}`,
    `AIM Score: ${wave.counts.aimScore}`,
    `Creditos restantes WAVE: ${wave.counts.creditsRemaining}`,
    formatWaveCategorySummary(wave),
  ].filter(Boolean);

  if (wave.notes && wave.notes.length > 0) {
    lines.push('Notas WAVE:');
    lines.push(...wave.notes.map((note) => `  - ${note}`));
  }

  if (detailedItems.length > 0) {
    lines.push('Hallazgos WAVE detallados (errors/contrast):');
    lines.push(...detailedItems.map((item, index) => buildWaveDetailLines(item, index)));
  } else {
    lines.push('Hallazgos WAVE detallados (errors/contrast): ninguno');
  }

  lines.push('');
  return lines.join('\n');
}

function resolveAuditStatus(unifiedFindings, coverage, wave) {
  const executedScenarios = coverage && coverage.scenarios ? coverage.scenarios.length : 0;
  const skippedScenarios = coverage && coverage.skippedScenarios ? coverage.skippedScenarios.length : 0;
  const warnings = [];

  if (skippedScenarios > 0) {
    warnings.push(`Se omitieron ${skippedScenarios} escenarios durante la auditoria.`);
  }

  if (wave && wave.enabled !== false && wave.status && wave.status !== 'ok') {
    warnings.push(`La integracion WAVE termino con estado ${translateWaveStatus(wave.status)}.`);
  }

  if (unifiedFindings.length > 0) {
    return {
      label: 'CON ERRORES',
      warnings,
    };
  }

  if (executedScenarios === 0 && skippedScenarios > 0) {
    warnings.unshift('No se ejecuto ningun escenario de axe-core, por lo que el resultado no es concluyente.');

    return {
      label: 'INCONCLUSO',
      warnings,
    };
  }

  if (wave && wave.enabled !== false && wave.status && wave.status !== 'ok') {
    warnings.unshift('WAVE no pudo completarse correctamente, por lo que el resultado no es concluyente.');

    return {
      label: 'INCONCLUSO',
      warnings,
    };
  }

  return {
    label: 'APROBADO',
    warnings,
  };
}

function printReport(url, axeJson, outDir) {
  outDir = outDir || OUTPUT_DIR;
  const violations = sortViolations(axeJson.violations || []);
  const coverage = axeJson.coverage || {};
  const pageVisibility = axeJson.pageVisibility || null;
  const wave = axeJson.wave || null;
  const contrastSlides = axeJson.contrastSlides || null;
  const unifiedFindings = collectUnifiedFindings(violations, wave);
  const autofixFindings = unifiedFindings.filter((finding) => finding.correctionType === 'autofix');
  const manualFindings = unifiedFindings.filter((finding) => finding.correctionType !== 'autofix');
  const totalUnifiedItems = unifiedFindings.reduce((acc, finding) => acc + finding.count, 0);
  const auditStatus = resolveAuditStatus(unifiedFindings, coverage, wave);

  let details = [
    '========================',
    '  Reporte de Accesibilidad  ',
    '========================',
    `URL auditada: ${url}`,
    `Estado: ${auditStatus.label}`,
    `Visibilidad detectada: ${formatPageVisibility(pageVisibility)}`,
    coverage.scenarios && coverage.scenarios.length > 0
      ? `Escenarios ejecutados: ${coverage.scenarios.length}`
      : null,
    coverage.skippedScenarios && coverage.skippedScenarios.length > 0
      ? `Escenarios omitidos: ${coverage.skippedScenarios.length}`
      : null,
    contrastSlides
      ? `Slides visuales de contraste: ${contrastSlides.fileName}`
      : null,
    `Elementos pendientes (consolidado): ${totalUnifiedItems}`,
    `Tipos con autofix: ${autofixFindings.length}`,
    `Tipos manuales: ${manualFindings.length}`,
    buildUnifiedRuleList('Autofix disponibles', autofixFindings),
    buildUnifiedRuleList('Correcciones manuales', manualFindings),
    auditStatus.warnings.length > 0
      ? ['Advertencias:', ...auditStatus.warnings.map((warning) => `  - ${warning}`)].join('\n')
      : null,
    '',
  ].join('\n');

  for (const finding of [...autofixFindings, ...manualFindings]) {
    details += buildUnifiedFindingSection(finding) + '\n';
  }

  details += buildWaveReportSection(wave, pageVisibility);

  if (GENERATE_HTML) {
    const reportFileName = 'accessibility-report.html';
    const originalConsoleLog = console.log;
    const originalStdoutWrite = process.stdout.write;
    let reportHtml = '';
    try {
      console.log = () => {};
      process.stdout.write = () => true;
      reportHtml = createHtmlReport({
        results: axeJson,
        options: {
          projectKey: 'SMG Accessibility Audit',
          doNotCreateReportFile: true,
        },
      });
    } finally {
      console.log = originalConsoleLog;
      process.stdout.write = originalStdoutWrite;
    }

    const reportPath = path.join(outDir, reportFileName);
    if (typeof reportHtml === 'string' && reportHtml.length > 0) {
      fs.writeFileSync(reportPath, reportHtml, 'utf8');
    }
  }

  const txtPath = path.join(outDir, 'accesibilidad_report.txt');
  fs.writeFileSync(txtPath, details, 'utf8');

  const contrastSlidesPath = path.join(outDir, CONTRAST_SLIDES_FILE_NAME);
  fs.writeFileSync(contrastSlidesPath, buildContrastSlidesHtml(url, axeJson, unifiedFindings), 'utf8');
}

function printTerminalSummary(url, axeJson) {
  const violations = sortViolations(axeJson.violations || []);
  const coverage = axeJson.coverage || {};
  const pageVisibility = axeJson.pageVisibility || null;
  const wave = axeJson.wave || null;
  const contrastSlides = axeJson.contrastSlides || null;
  const unifiedFindings = collectUnifiedFindings(violations, wave);
  const autofixFindings = unifiedFindings.filter((finding) => finding.correctionType === 'autofix');
  const manualFindings = unifiedFindings.filter((finding) => finding.correctionType !== 'autofix');
  const totalNodes = unifiedFindings.reduce((acc, finding) => acc + finding.count, 0);
  const auditStatus = resolveAuditStatus(unifiedFindings, coverage, wave);
  const autofixSummary = autofixFindings.length > 0
    ? autofixFindings.map((finding) => `${finding.ruleId}=${finding.count}`).join(', ')
    : 'ninguno';
  const manualSummary = manualFindings.length > 0
    ? manualFindings.map((finding) => `${finding.ruleId}=${finding.count}`).join(', ')
    : 'ninguno';

  console.log('========================');
  console.log('  Reporte de Accesibilidad');
  console.log('========================');
  console.log(`URL auditada: ${url}`);
  console.log(`Estado: ${auditStatus.label}`);
  console.log(`Visibilidad detectada: ${formatPageVisibility(pageVisibility)}`);
  if (coverage.scenarios && coverage.scenarios.length > 0) {
    console.log(`Escenarios ejecutados: ${coverage.scenarios.length}`);
  }
  if (coverage.skippedScenarios && coverage.skippedScenarios.length > 0) {
    console.log(`Escenarios omitidos: ${coverage.skippedScenarios.length}`);
  }
  console.log(`Elementos pendientes (consolidado): ${totalNodes}`);
  console.log(`Autofix: ${autofixSummary}`);
  console.log(`Manual: ${manualSummary}`);
  if (auditStatus.warnings.length > 0) {
    console.log(`Advertencias: ${auditStatus.warnings.join(' | ')}`);
  }
  if (contrastSlides) {
    console.log(`Slides contraste: ${contrastSlides.fileName} (${contrastSlides.capturedCount}/${contrastSlides.totalCount})`);
  }
}

async function asanaRequest(method, endpoint, body, token) {
  const response = await fetchWithTimeout(`${ASANA_API_BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify({ data: body }) } : {}),
  }, 30000);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Asana API ${response.status}: ${errorText}`);
  }

  return response.json();
}

function extractDomainSlug(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname
      .replace(/\.myshopify\.com$/, '')
      .replace(/\.(com|co|net|org|io|shop|store)$/, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

function scoreProjectMatch(projectName, domainSlug) {
  const normName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normSlug = domainSlug.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  if (normName === normSlug) {
    return 100;
  }

  if (normName.includes(normSlug) || normSlug.includes(normName)) {
    return 80;
  }

  const nameWords = normName.split(' ').filter((w) => w.length > 2);
  const slugWords = normSlug.split(' ').filter((w) => w.length > 2);
  const overlap = nameWords.filter((w) => slugWords.some((sw) => sw.includes(w) || w.includes(sw)));

  return overlap.length > 0
    ? Math.round((overlap.length / Math.max(nameWords.length, slugWords.length)) * 60)
    : 0;
}

async function findAsanaProject(url, token, forcedGid) {
  if (forcedGid) {
    const result = await asanaRequest('GET', `/projects/${forcedGid}?opt_fields=gid,name`, null, token);
    return [{ ...result.data, score: 100 }];
  }

  const domainSlug = extractDomainSlug(url);

  if (!domainSlug) {
    return [];
  }

  const projects = [];
  let offset = '';

  while (true) {
    const qs = offset
      ? `limit=100&opt_fields=gid,name&offset=${encodeURIComponent(offset)}`
      : 'limit=100&opt_fields=gid,name';
    const result = await asanaRequest('GET', `/workspaces/${ASANA_WORKSPACE_GID}/projects?${qs}`, null, token);
    projects.push(...(result.data || []));

    if (result.next_page && result.next_page.offset) {
      offset = result.next_page.offset;
    } else {
      break;
    }
  }

  return projects
    .map((project) => ({ ...project, score: scoreProjectMatch(project.name, domainSlug) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

function buildPageSummaryHtmlNotes(url, axeJson) {
  const violations = sortViolations(axeJson.violations || []);
  const wave = axeJson.wave || null;
  const coverage = axeJson.coverage || {};
  const unifiedFindings = collectUnifiedFindings(violations, wave);
  const autofixFindings = unifiedFindings.filter((f) => f.correctionType === 'autofix');
  const manualFindings = unifiedFindings.filter((f) => f.correctionType !== 'autofix');
  const auditStatus = resolveAuditStatus(unifiedFindings, coverage, wave);
  const totalNodes = unifiedFindings.reduce((acc, f) => acc + f.count, 0);
  const statusEmoji = auditStatus.label === 'APROBADO' ? '&#x2705;' : auditStatus.label === 'INCONCLUSO' ? '&#x26A0;&#xFE0F;' : '&#x274C;';

  let html = '<body>';
  html += `<strong>URL:</strong> ${escapeHtml(url)}\n`;
  html += `<strong>Estado:</strong> ${statusEmoji} ${escapeHtml(auditStatus.label)}\n`;
  html += `<strong>Elementos afectados:</strong> ${totalNodes}\n`;

  if (coverage.scenarios && coverage.scenarios.length > 0) {
    html += `<strong>Escenarios ejecutados:</strong> ${coverage.scenarios.length}\n`;
  }

  html += '\n';

  if (autofixFindings.length > 0) {
    html += '<strong>Autofix disponible:</strong>\n<ul>';
    for (const finding of autofixFindings) {
      html += `<li><code>${escapeHtml(finding.ruleId)}</code> &#x2014; ${finding.count} elemento(s)</li>`;
    }
    html += '</ul>';
  }

  if (manualFindings.length > 0) {
    html += '<strong>Correccion manual requerida:</strong>\n<ul>';
    for (const finding of manualFindings) {
      html += `<li><code>${escapeHtml(finding.ruleId)}</code> &#x2014; ${finding.count} elemento(s)</li>`;
    }
    html += '</ul>';
  }

  if (unifiedFindings.length === 0) {
    html += '<strong>No se encontraron errores de accesibilidad.</strong>\n';
  }

  html += '</body>';
  return html;
}

function buildRuleFindingHtmlNotes(url, finding) {
  let html = '<body>';
  html += `<strong>Regla:</strong> <code>${escapeHtml(finding.ruleId)}</code>\n`;
  html += `<strong>URL:</strong> ${escapeHtml(url)}\n`;
  html += `<strong>Correccion:</strong> ${escapeHtml(getFixStrategyLabel(finding.ruleId))}\n`;
  html += `<strong>Elementos afectados:</strong> ${finding.count}\n`;
  html += `<strong>Resumen:</strong> ${escapeHtml(finding.summaryLabel)}\n`;
  html += '\n<strong>Elementos con error:</strong>\n<ul>';

  for (const sample of finding.samples) {
    if (sample.kind === 'axe' && sample.node) {
      const { node } = sample;
      const metadata = node.metadata || {};
      const { ratio, min } = extractContrastDetails(node);

      html += '<li>';
      if (metadata.tagName) {
        html += `<code>${escapeHtml(metadata.tagName)}</code> `;
      }
      if (metadata.className && metadata.className !== '(sin clase)') {
        html += `<em>${escapeHtml(shortenText(metadata.className, 60))}</em> `;
      }
      if (metadata.nearestParent) {
        html += `&#x2014; ${escapeHtml(metadata.nearestParent)}`;
      }
      if (node.html) {
        html += `\n<code>${escapeHtml(shortenText(node.html.replace(/\s+/g, ' ').trim(), 160))}</code>`;
      }
      if (finding.ruleId === 'color-contrast' && ratio !== 'No disponible') {
        html += `\nContraste: ${escapeHtml(String(ratio))} &#x2014; minimo requerido: ${escapeHtml(String(min))}`;
      }
      html += '</li>';
    } else if (sample.kind === 'wave-node' && sample.node) {
      const { node } = sample;
      const metadata = node.metadata || {};

      html += '<li>';
      if (metadata.tagName) {
        html += `<code>${escapeHtml(metadata.tagName)}</code> `;
      }
      if (node.textSnippet) {
        html += `"${escapeHtml(shortenText(node.textSnippet, 100))}"`;
      }
      if (node.html) {
        html += `\n<code>${escapeHtml(shortenText(node.html, 160))}</code>`;
      }
      html += '</li>';
    } else if (sample.label) {
      html += `<li>${escapeHtml(sample.label)}</li>`;
    }
  }

  html += '</ul></body>';
  return html;
}

async function createRuleSubtasks(pageTaskGid, url, axeJson, outDir, token) {
  const violations = sortViolations(axeJson.violations || []);
  const wave = axeJson.wave || null;
  const unifiedFindings = collectUnifiedFindings(violations, wave);

  for (const finding of unifiedFindings) {
    const fixEmoji = finding.correctionType === 'autofix' ? '&#x1F527;' : '&#x270B;';

    try {
      const result = await asanaRequest('POST', `/tasks/${pageTaskGid}/subtasks`, {
        name: `${finding.correctionType === 'autofix' ? '🔧' : '✋'} ${finding.ruleId} — ${finding.count} elemento(s)`,
        html_notes: buildRuleFindingHtmlNotes(url, finding),
      }, token);

    } catch (err) {
      console.warn(`[ASANA]   Error en subtarea ${finding.ruleId}: ${err.message}`);
    }
  }
}

async function uploadFileToAsanaTask(taskGid, filePath, token) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const boundary = `----FormBoundary${Date.now()}`;
  const CRLF = '\r\n';

  const preamble = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="parent"',
    '',
    taskGid,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '',
  ].join(CRLF));

  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([preamble, fileContent, epilogue]);

  const response = await fetchWithTimeout(`${ASANA_API_BASE}/attachments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  }, 60000);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Asana attachment HTTP ${response.status}: ${errText}`);
  }

  return response.json();
}

async function createAsanaSiteAuditTasks(auditUrl, siteResults, token) {
  console.log('\n[ASANA] Buscando proyecto...');

  let candidates;

  try {
    candidates = await findAsanaProject(auditUrl, token, ASANA_FORCED_PROJECT_GID);
  } catch (err) {
    console.error(`[ASANA] Error al buscar proyecto: ${err.message}`);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log('[ASANA] No se encontro un proyecto que coincida con el dominio.');
    console.log('[ASANA] Usa --asana-project-gid para especificarlo manualmente.');
    return;
  }

  const selectedProject = candidates[0];

  console.log(`[ASANA] Proyecto seleccionado: "${selectedProject.name}" (coincidencia ${selectedProject.score}%)`);

  const domain = new URL(auditUrl).hostname;
  const dateStr = new Date().toISOString().slice(0, 10);
  const isSiteMode = siteResults.length > 1;

  const firstResult = siteResults[0];
  const firstPath = (() => { try { return new URL(firstResult.url).pathname || '/'; } catch { return firstResult.url; } })();
  const firstViolations = sortViolations(firstResult.axeJson.violations || []);
  const firstFindings = collectUnifiedFindings(firstViolations, firstResult.axeJson.wave || null);
  const firstStatus = resolveAuditStatus(firstFindings, firstResult.axeJson.coverage || {}, firstResult.axeJson.wave || null);
  const firstTotalNodes = firstFindings.reduce((acc, f) => acc + f.count, 0);

  const parentName = isSiteMode
    ? `[ADA Audit] ${domain} — ${dateStr}`
    : `[ADA Audit] ${domain} — ${dateStr} - ${firstPath} — ${firstStatus.label} (${firstTotalNodes} elementos)`;

  const pagesWithErrors = siteResults.filter(({ axeJson }) => {
    const findings = collectUnifiedFindings(sortViolations(axeJson.violations || []), axeJson.wave || null);
    return findings.length > 0;
  }).length;

  const parentHtmlNotes = isSiteMode
    ? `<body><strong>Auditoria de accesibilidad WCAG 2.2 AA</strong>\n<strong>Sitio:</strong> ${escapeHtml(auditUrl)}\n<strong>Paginas auditadas:</strong> ${siteResults.length}\n<strong>Paginas con errores:</strong> ${pagesWithErrors}\n<strong>Fecha:</strong> ${escapeHtml(dateStr)}\n</body>`
    : buildPageSummaryHtmlNotes(firstResult.url, firstResult.axeJson);

  console.log(`[ASANA] Creando tarea principal en "${selectedProject.name}"...`);

  let parentGid;

  try {
    const parentResult = await asanaRequest('POST', '/tasks', {
      name: parentName,
      projects: [selectedProject.gid],
      html_notes: parentHtmlNotes,
    }, token);
    parentGid = parentResult.data.gid;
  } catch (err) {
    console.error(`[ASANA] Error al crear tarea principal: ${err.message}`);
    return;
  }

  console.log(`[ASANA] Tarea principal: https://app.asana.com/0/${selectedProject.gid}/${parentGid}`);

  if (isSiteMode) {
    for (const { url, axeJson, outDir } of siteResults) {
      const urlPath = (() => { try { return new URL(url).pathname || '/'; } catch { return url; } })();
      const violations = sortViolations(axeJson.violations || []);
      const wave = axeJson.wave || null;
      const unifiedFindings = collectUnifiedFindings(violations, wave);
      const coverage = axeJson.coverage || {};
      const auditStatus = resolveAuditStatus(unifiedFindings, coverage, wave);
      const totalNodes = unifiedFindings.reduce((acc, f) => acc + f.count, 0);

      console.log(`[ASANA] Subtarea pagina: ${urlPath}...`);

      let pageTaskGid;

      try {
        const pageResult = await asanaRequest('POST', `/tasks/${parentGid}/subtasks`, {
          name: `${urlPath} — ${auditStatus.label} (${totalNodes} elementos)`,
          html_notes: buildPageSummaryHtmlNotes(url, axeJson),
        }, token);
        pageTaskGid = pageResult.data.gid;
      } catch (err) {
        console.warn(`[ASANA]   Error al crear subtarea ${urlPath}: ${err.message}`);
        continue;
      }

      if (outDir) {
        const slidesPath = path.join(outDir, CONTRAST_SLIDES_FILE_NAME);
        if (fs.existsSync(slidesPath) && fs.statSync(slidesPath).size > 500) {
          try {
            await uploadFileToAsanaTask(pageTaskGid, slidesPath, token);
            console.log(`[ASANA]   Slides de contraste adjuntados.`);
          } catch (attachErr) {
            console.warn(`[ASANA]   No se pudo adjuntar slides: ${attachErr.message}`);
          }
        }
      }

      if (unifiedFindings.length > 0) {
        console.log(`[ASANA]   Creando sub-subtareas por regla...`);
        await createRuleSubtasks(pageTaskGid, url, axeJson, outDir, token);
      }
    }
  } else {
    console.log(`[ASANA] Creando subtareas por regla...`);
    await createRuleSubtasks(parentGid, firstResult.url, firstResult.axeJson, firstResult.outDir, token);

    if (firstResult.outDir) {
      const slidesPath = path.join(firstResult.outDir, CONTRAST_SLIDES_FILE_NAME);
      if (fs.existsSync(slidesPath) && fs.statSync(slidesPath).size > 500) {
        try {
          await uploadFileToAsanaTask(parentGid, slidesPath, token);
          console.log(`[ASANA] Slides de contraste adjuntados a la tarea principal.`);
        } catch (attachErr) {
          console.warn(`[ASANA] No se pudo adjuntar slides: ${attachErr.message}`);
        }
      }
    }
  }

  console.log(`\n[ASANA] Tickets creados: https://app.asana.com/0/${selectedProject.gid}/${parentGid}`);
}

(async () => {
  try {
    const axeJson = await runAudit(AUDIT_URL);
    printReport(AUDIT_URL, axeJson);
    printTerminalSummary(AUDIT_URL, axeJson);
    logAuditProgress(100, 'Auditoria completada');

    const siteResults = [{ url: AUDIT_URL, axeJson, outDir: OUTPUT_DIR }];

    if (!SITE_MODE) {
      if (ASANA_MODE) {
        if (!ASANA_TOKEN) {
          console.error('[ASANA] Falta el token. Usa --asana-token o la variable ASANA_TOKEN / ASANA_PAT.');
        } else {
          await createAsanaSiteAuditTasks(AUDIT_URL, siteResults, ASANA_TOKEN);
        }
      }

      return;
    }

    console.log('\n[SITE] Descubriendo paginas del sitio...');
    const siteUrls = await discoverSiteUrls(AUDIT_URL);
    console.log(`[SITE] ${siteUrls.length} pagina(s) descubierta(s).`);

    if (siteUrls.length === 0) {
      console.log('[SITE] No se encontraron paginas adicionales para auditar.');
    }

    let autoMode = false;

    for (let i = 0; i < siteUrls.length; i++) {
      const pageUrl = siteUrls[i];
      let shouldAudit = autoMode;

      if (!autoMode) {
        const answer = await promptUser(
          `\n[SITE] (${i + 1}/${siteUrls.length}) ${pageUrl}\n  [y] Auditar  [n] Omitir  [a] Auditar todas las siguientes automaticamente\n  > `,
        );

        if (answer === 'a') {
          autoMode = true;
          shouldAudit = true;
        } else if (answer === 'y') {
          shouldAudit = true;
        } else {
          console.log('[SITE] Pagina omitida.');
          continue;
        }
      }

      if (shouldAudit) {
        console.log(`\n[SITE] Auditando: ${pageUrl}`);

        try {
          const pageSlug = slugifyUrl(pageUrl);
          const pageOutDir = path.join(OUTPUT_DIR, pageSlug);
          fs.mkdirSync(pageOutDir, { recursive: true });
          const pageAxeJson = await runAudit(pageUrl);
          printReport(pageUrl, pageAxeJson, pageOutDir);
          printTerminalSummary(pageUrl, pageAxeJson);
          logAuditProgress(100, `Pagina auditada: ${pageUrl}`);
          siteResults.push({ url: pageUrl, axeJson: pageAxeJson, outDir: pageOutDir });
        } catch (pageErr) {
          console.error(`[SITE] Error auditando ${pageUrl}: ${pageErr.message}`);
        }
      }
    }

    console.log('\n[SITE] Auditoria del sitio completada.');

    if (ASANA_MODE) {
      if (!ASANA_TOKEN) {
        console.error('[ASANA] Falta el token. Usa --asana-token o la variable ASANA_TOKEN / ASANA_PAT.');
      } else {
        await createAsanaSiteAuditTasks(AUDIT_URL, siteResults, ASANA_TOKEN);
      }
    }
  } catch (err) {
    console.error('Error ejecutando auditoría:', err.message);
    process.exit(1);
  }
})();
