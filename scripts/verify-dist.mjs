#!/usr/bin/env node
/**
 * Post-build sanity check for `dist/`. Catches shipping regressions that a
 * green typecheck/test run cannot — missing bundles, a broken manifest, or
 * icons that were not copied. Runs at the end of `npm run check`.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

const REQUIRED_FILES = [
  'background.js',
  'content.js',
  'page-hook.js',
  'popup.js',
  'popup.html',
  'popup.css',
  'activity.html',
  'dashboard.js',
  'dashboard.html',
  'dashboard.css',
  'fonts/inter-latin-400-normal.woff2',
  'fonts/inter-latin-500-normal.woff2',
  'fonts/inter-latin-600-normal.woff2',
  'fonts/inter-latin-700-normal.woff2',
  'licenses/inter-OFL.txt',
  'licenses/lucide-react-MIT.txt',
  'licenses/react-MIT.txt',
  'licenses/react-dom-MIT.txt',
  'manifest.json',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

const errors = [];
for (const relative of REQUIRED_FILES) {
  const path = join(dist, relative);
  if (!existsSync(path)) {
    errors.push(`missing: ${relative}`);
    continue;
  }
  if (statSync(path).size === 0) errors.push(`empty: ${relative}`);
}

if (!errors.length) {
  try {
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    if (manifest.manifest_version !== 3) errors.push('manifest.manifest_version is not 3');
    if (manifest.background?.type !== 'module') errors.push('background.type should be "module"');
    for (const size of ['16', '48', '128']) {
      if (!manifest.icons?.[size]) errors.push(`manifest.icons.${size} missing`);
    }
    if (!manifest.action?.default_popup) errors.push('action.default_popup missing');
  } catch (error) {
    errors.push(`manifest.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (errors.length) {
  for (const line of errors) console.error(`verify-dist: ${line}`);
  process.exit(1);
}
console.log(`verify-dist: dist/ looks shippable (${REQUIRED_FILES.length} files, manifest OK).`);
