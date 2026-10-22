// Bundles the extension into dist/ (load that folder as an unpacked extension).
// Usage: node scripts/build.mjs [--watch] [--clean]
import { context, build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outdir = 'dist';
const watch = process.argv.includes('--watch');
const cleanOnly = process.argv.includes('--clean');

await rm(outdir, { recursive: true, force: true });
if (cleanOnly) process.exit(0);

const common = {
  bundle: true,
  sourcemap: true,
  target: 'chrome111',
  outdir,
  legalComments: 'none',
  logLevel: 'info',
};

// The service worker is an ES module (manifest: "type": "module").
// Content scripts and the popup are classic scripts, so they are IIFE bundles.
const configs = [
  { ...common, format: 'esm', entryPoints: { background: 'src/background/index.ts' } },
  {
    ...common,
    format: 'iife',
    entryPoints: {
      content: 'src/content/index.ts',
      'page-hook': 'src/page-hooks/index.ts',
      popup: 'src/popup/popup.ts',
      dashboard: 'src/dashboard/dashboard.tsx',
    },
    jsx: 'automatic',
  },
];

async function copyStatic() {
  await cp('public', outdir, { recursive: true });
  await cp('src/popup/popup.html', `${outdir}/popup.html`);
  await cp('src/popup/activity.html', `${outdir}/activity.html`);
  await cp('src/popup/popup.css', `${outdir}/popup.css`);
  await cp('src/dashboard/dashboard.html', `${outdir}/dashboard.html`);
  await cp('src/dashboard/dashboard.css', `${outdir}/dashboard.css`);
  const interFiles = [
    'inter-latin-400-normal.woff2',
    'inter-latin-500-normal.woff2',
    'inter-latin-600-normal.woff2',
    'inter-latin-700-normal.woff2',
  ];
  await mkdir(`${outdir}/fonts`, { recursive: true });
  await Promise.all(
    interFiles.map((file) => cp(`node_modules/@fontsource/inter/files/${file}`, `${outdir}/fonts/${file}`)),
  );
  await mkdir(`${outdir}/licenses`, { recursive: true });
  await Promise.all([
    cp('node_modules/@fontsource/inter/LICENSE', `${outdir}/licenses/inter-OFL.txt`),
    cp('node_modules/lucide-react/LICENSE', `${outdir}/licenses/lucide-react-MIT.txt`),
    cp('node_modules/react/LICENSE', `${outdir}/licenses/react-MIT.txt`),
    cp('node_modules/react-dom/LICENSE', `${outdir}/licenses/react-dom-MIT.txt`),
  ]);
}

if (watch) {
  for (const config of configs) {
    const ctx = await context(config);
    await ctx.watch();
  }
  await copyStatic();
  console.log(
    'Watching for changes. Static files (manifest, popup.html/css) are copied once; re-run on change.',
  );
} else {
  await Promise.all(configs.map((config) => build(config)));
  await copyStatic();
}
