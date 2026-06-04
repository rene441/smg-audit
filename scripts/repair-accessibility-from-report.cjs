#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CURRENT_PROJECT_PATH = process.cwd();

function resolveProjectPath(projectArg) {
  if (typeof projectArg !== 'string' || projectArg.trim() === '') {
    return path.resolve(CURRENT_PROJECT_PATH);
  }

  return path.resolve(projectArg);
}

const argv = yargs(hideBin(process.argv))
  .option('project', {
    alias: 'p',
    describe: 'Ruta raiz del proyecto Shopify a reparar. Si se omite el valor, usa el directorio actual.',
    type: 'string',
    default: CURRENT_PROJECT_PATH,
  })
  .option('report', {
    alias: 'r',
    describe: 'Ruta al accesibilidad_report.txt (opcional)',
    type: 'string',
  })
  .option('report-dir', {
    describe: 'Carpeta donde esta accesibilidad_report.txt',
    type: 'string',
  })
  .help()
  .argv;

const DEFAULT_REPORT_DIR = path.resolve(argv.reportDir || process.env.SMG_ACCESSIBILITY_OUTPUT_DIR || path.join(process.cwd(), '.smg-accessibility-audit'));
const DEFAULT_REPORT_PATH = path.join(DEFAULT_REPORT_DIR, 'accesibilidad_report.txt');
const REPORT_PATH = argv.report ? path.resolve(argv.report) : DEFAULT_REPORT_PATH;
const PROJECT_PATH = resolveProjectPath(argv.project);

const SCAN_EXTENSIONS = new Set(['.liquid', '.html', '.htm']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectFilesRecursively(rootPath) {
  const collected = [];

  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (SCAN_EXTENSIONS.has(extension)) {
        collected.push(fullPath);
      }
    }
  };

  walk(rootPath);
  return collected;
}

function parseSampleLines(sampleLines) {
  const parsedEntry = {
    className: '(sin clase)',
    nearestParent: '',
    html: '',
  };

  for (const sampleLine of sampleLines) {
    const segments = sampleLine
      .trim()
      .split(' | ')
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments) {
      if (segment.startsWith('Clase:')) {
        parsedEntry.className = segment.replace(/^Clase:\s*/, '').trim() || '(sin clase)';
      }

      if (segment.startsWith('Padre cercano:')) {
        parsedEntry.nearestParent = segment.replace(/^Padre cercano:\s*/, '').trim();
      }

      if (segment.startsWith('HTML:')) {
        parsedEntry.html = segment.replace(/^HTML:\s*/, '').trim();
      }
    }
  }

  return parsedEntry;
}

function parseSectionSamples(section, rule) {
  const lines = section.split('\n');
  const entries = [];
  let currentSampleLines = null;

  const flushSample = () => {
    if (!currentSampleLines || currentSampleLines.length === 0) {
      return;
    }

    entries.push({
      rule,
      ...parseSampleLines(currentSampleLines),
    });
  };

  for (const line of lines) {
    const sampleStartMatch = line.match(/^\s*\d+\.\s*(.*)$/);

    if (sampleStartMatch) {
      flushSample();
      currentSampleLines = [];

      if (sampleStartMatch[1]) {
        currentSampleLines.push(sampleStartMatch[1]);
      }

      continue;
    }

    if (currentSampleLines && line.trim()) {
      currentSampleLines.push(line);
    }
  }

  flushSample();
  return entries;
}

function parseReport(reportText) {
  const sections = reportText
    .split('------------------------')
    .map((part) => part.trim())
    .filter((part) => part.includes('Regla:'));

  const entries = [];

  for (const section of sections) {
    const ruleMatch = section.match(/^Regla:\s*(.+)$/m);
    const rule = ruleMatch ? ruleMatch[1].trim() : '';

    entries.push(...parseSectionSamples(section, rule));
  }

  return entries;
}

function getSrcToken(html) {
  const srcMatch = html.match(/src\s*=\s*"([^"]+)"|src\s*=\s*'([^']+)'/i);
  const srcValue = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : '';

  if (!srcValue) {
    return '';
  }

  const cleanSrc = srcValue.split('?')[0];
  const fileName = cleanSrc.split('/').filter(Boolean).pop() || '';
  return fileName;
}

function addEmptyAltToImgTag(imgTag) {
  if (/\balt\s*=/.test(imgTag)) {
    return imgTag;
  }

  if (imgTag.endsWith('/>')) {
    return imgTag.replace(/\s*\/?>$/, ' alt="" />');
  }

  return imgTag.replace(/\s*>$/, ' alt="">');
}

function fixImageAltByClass(content, classToken) {
  if (!classToken) {
    return { updatedContent: content, replacements: 0 };
  }

  const classPattern = escapeRegExp(classToken);
  const regex = new RegExp(`<img\\b(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${classPattern}\\b[^"']*["'])(?![^>]*\\balt\\s*=)[^>]*>`, 'gi');
  let replacements = 0;

  const updatedContent = content.replace(regex, (match) => {
    replacements += 1;
    return addEmptyAltToImgTag(match);
  });

  return { updatedContent, replacements };
}

function fixImageAltBySrcToken(content, srcToken) {
  if (!srcToken) {
    return { updatedContent: content, replacements: 0 };
  }

  const tokenPattern = escapeRegExp(srcToken);
  const regex = new RegExp(`<img\\b(?=[^>]*\\bsrc\\s*=\\s*["'][^"']*${tokenPattern}[^"']*["'])(?![^>]*\\balt\\s*=)[^>]*>`, 'gi');
  let replacements = 0;

  const updatedContent = content.replace(regex, (match) => {
    replacements += 1;
    return addEmptyAltToImgTag(match);
  });

  return { updatedContent, replacements };
}

function extractPrimaryClassToken(className) {
  if (!className || className === '(sin clase)') {
    return '';
  }

  return className.split(/\s+/).filter(Boolean)[0] || '';
}

function extractClassTokensFromLocator(locator) {
  if (!locator) {
    return [];
  }

  return [...new Set(
    (locator.match(/\.([A-Za-z0-9_-]+)/g) || [])
      .map((token) => token.slice(1))
      .filter(Boolean),
  )];
}

function hasLiquidHelperClassMatch(content, helperName, classTokens) {
  if (!classTokens || classTokens.length === 0) {
    return false;
  }

  if (!content.includes(`| ${helperName}:`)) {
    return false;
  }

  const helperRegex = new RegExp(`\{\{[\s\S]*?\|\s*${helperName}\s*:[\s\S]*?\}\}`, 'gi');
  const helperBlocks = content.match(helperRegex) || [];

  if (helperBlocks.length === 0) {
    return classTokens.some((classToken) => content.includes(classToken));
  }

  return helperBlocks.some((helperBlock) => classTokens.some((classToken) => {
    const classPattern = escapeRegExp(classToken);
    return new RegExp(`class\s*:\s*['"][^'"]*\b${classPattern}\b[^'"]*['"]`, 'i').test(helperBlock);
  }));
}

function getHrefValue(html) {
  const hrefMatch = html.match(/href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/i);
  return hrefMatch ? (hrefMatch[1] || hrefMatch[2] || '') : '';
}

function getHrefToken(html) {
  const hrefValue = getHrefValue(html);
  if (!hrefValue) {
    return '';
  }

  return hrefValue.split('?')[0].trim();
}

function stripHtmlTags(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function needsLinkNameAutofix(anchorTag) {
  if (/\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/i.test(anchorTag)) {
    return false;
  }

  const innerMatch = anchorTag.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const innerText = innerMatch ? stripHtmlTags(innerMatch[1]) : '';

  return innerText.length === 0;
}

function buildAriaLabelFromHref(hrefValue) {
  if (!hrefValue) {
    return 'Enlace';
  }

  const cleanHref = hrefValue.split('?')[0].split('#')[0];
  const segment = cleanHref.split('/').filter(Boolean).pop();

  if (!segment) {
    return 'Enlace';
  }

  const label = segment
    .replace(/[-_]+/g, ' ')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label) {
    return 'Enlace';
  }

  return label
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function addAriaLabelToAnchor(anchorTag, label) {
  if (/\baria-label\s*=/i.test(anchorTag)) {
    return anchorTag;
  }

  return anchorTag.replace(/<a\b/i, `<a aria-label="${label}"`);
}

function fixLinkNameByClass(content, classToken, ariaLabel) {
  if (!classToken) {
    return { updatedContent: content, replacements: 0 };
  }

  const classPattern = escapeRegExp(classToken);
  const anchorRegex = /<a\b[\s\S]*?<\/a>/gi;
  let replacements = 0;

  const updatedContent = content.replace(anchorRegex, (anchorTag) => {
    const hasClassToken = new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${classPattern}\\b[^"']*["']`, 'i').test(anchorTag);

    if (!hasClassToken || !needsLinkNameAutofix(anchorTag)) {
      return anchorTag;
    }

    replacements += 1;
    return addAriaLabelToAnchor(anchorTag, ariaLabel);
  });

  return { updatedContent, replacements };
}

function fixLinkNameByHref(content, hrefToken, ariaLabel) {
  if (!hrefToken) {
    return { updatedContent: content, replacements: 0 };
  }

  const hrefPattern = escapeRegExp(hrefToken);
  const anchorRegex = /<a\b[\s\S]*?<\/a>/gi;
  let replacements = 0;

  const updatedContent = content.replace(anchorRegex, (anchorTag) => {
    const hasHrefToken = new RegExp(`\\bhref\\s*=\\s*["'][^"']*${hrefPattern}[^"']*["']`, 'i').test(anchorTag);

    if (!hasHrefToken || !needsLinkNameAutofix(anchorTag)) {
      return anchorTag;
    }

    replacements += 1;
    return addAriaLabelToAnchor(anchorTag, ariaLabel);
  });

  return { updatedContent, replacements };
}

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error('No se encontro el reporte de accesibilidad:');
    console.error(REPORT_PATH);
    process.exit(1);
  }

  if (!fs.existsSync(PROJECT_PATH)) {
    console.error('No se encontro la ruta del proyecto:');
    console.error(PROJECT_PATH);
    process.exit(1);
  }

  const reportContent = fs.readFileSync(REPORT_PATH, 'utf8');
  const entries = parseReport(reportContent);
  const totalEntries = entries.length;
  const imageAltEntries = entries.filter((entry) => entry.rule === 'image-alt');
  const linkNameEntries = entries.filter((entry) => entry.rule === 'link-name');
  const autoFixableEntries = imageAltEntries.length + linkNameEntries.length;
  const autoFixableRules = new Set(['image-alt', 'link-name']);
  const nonAutoRules = [...new Set(entries.filter((entry) => !autoFixableRules.has(entry.rule)).map((entry) => entry.rule))];

  if (imageAltEntries.length === 0 && linkNameEntries.length === 0) {
    console.log('No se encontraron errores auto-reparables (image-alt/link-name).');
    if (nonAutoRules.length > 0) {
      console.log(`Reglas pendientes manuales: ${nonAutoRules.join(', ')}`);
    }
    process.exit(0);
  }

  const files = collectFilesRecursively(PROJECT_PATH);
  let totalImageAltFixes = 0;
  let totalLinkNameFixes = 0;
  const touchedFiles = new Set();
  let foundImageTagHelperMatches = false;
  let foundVideoTagHelperMatches = false;

  for (const filePath of files) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const entry of imageAltEntries) {
      const classToken = extractPrimaryClassToken(entry.className);
      const srcToken = getSrcToken(entry.html);
      const helperClassTokens = [...new Set([
        ...extractClassTokensFromLocator(entry.nearestParent),
        classToken,
      ].filter(Boolean))];

      let classFix = { updatedContent: content, replacements: 0 };
      let srcFix = { updatedContent: content, replacements: 0 };

      if (!foundImageTagHelperMatches && hasLiquidHelperClassMatch(content, 'image_tag', helperClassTokens)) {
        foundImageTagHelperMatches = true;
      }

      if (!foundVideoTagHelperMatches && hasLiquidHelperClassMatch(content, 'video_tag', helperClassTokens)) {
        foundVideoTagHelperMatches = true;
      }

      if (classToken) {
        classFix = fixImageAltByClass(content, classToken);
        content = classFix.updatedContent;
        totalImageAltFixes += classFix.replacements;
      }

      if (srcToken) {
        srcFix = fixImageAltBySrcToken(content, srcToken);
        content = srcFix.updatedContent;
        totalImageAltFixes += srcFix.replacements;
      }
    }

    for (const entry of linkNameEntries) {
      const classToken = extractPrimaryClassToken(entry.className);
      const hrefToken = getHrefToken(entry.html);
      const hrefValue = getHrefValue(entry.html);
      const ariaLabel = buildAriaLabelFromHref(hrefValue);

      let classFix = { updatedContent: content, replacements: 0 };
      let hrefFix = { updatedContent: content, replacements: 0 };

      if (classToken) {
        classFix = fixLinkNameByClass(content, classToken, ariaLabel);
        content = classFix.updatedContent;
        totalLinkNameFixes += classFix.replacements;
      }

      if (hrefToken) {
        hrefFix = fixLinkNameByHref(content, hrefToken, ariaLabel);
        content = hrefFix.updatedContent;
        totalLinkNameFixes += hrefFix.replacements;
      }
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      touchedFiles.add(filePath);
    }
  }

  console.log('====================================');
  console.log('  Reparacion de Accesibilidad (SMG) ');
  console.log('====================================');
  console.log(`Reporte usado: ${REPORT_PATH}`);
  console.log(`Proyecto reparado: ${PROJECT_PATH}`);
  console.log(`Errores leidos del reporte: ${totalEntries}`);
  console.log(`Errores auto-reparables detectados: ${autoFixableEntries}`);
  console.log(`Fixes aplicados (image-alt): ${totalImageAltFixes}`);
  console.log(`Fixes aplicados (link-name): ${totalLinkNameFixes}`);
  console.log(`Fixes aplicados (total): ${totalImageAltFixes + totalLinkNameFixes}`);
  console.log(`Archivos modificados: ${touchedFiles.size}`);

  if (autoFixableEntries === 0) {
    console.log('');
    console.log('No se aplicaron fixes automaticos porque este reporte no incluye reglas auto-reparables (image-alt/link-name).');
  }

  if (autoFixableEntries > 0 && totalImageAltFixes + totalLinkNameFixes === 0) {
    console.log('');
    console.log('No se aplicaron fixes automaticos sobre el source.');

    if (foundImageTagHelperMatches) {
      console.log('- Se encontraron coincidencias dentro de bloques Liquid image_tag. Si esos bloques ya definen alt:, este script no reescribe nada.');
    }

    if (foundVideoTagHelperMatches) {
      console.log('- Se encontraron coincidencias dentro de bloques Liquid video_tag. Shopify genera una imagen preview interna y este autofix no la reescribe.');
    }

    if (!foundImageTagHelperMatches && !foundVideoTagHelperMatches) {
      console.log('- El HTML reportado no se encontro como <img> o <a> editable en los archivos del tema.');
    }
  }

  if (touchedFiles.size > 0) {
    console.log('Lista de archivos modificados:');
    for (const filePath of touchedFiles) {
      console.log(`- ${filePath}`);
    }
  }

  if (nonAutoRules.length > 0) {
    console.log('');
    console.log(`Pendientes manuales (sin autofix): ${nonAutoRules.join(', ')}`);
  }
}

main();