// Package the dist/ folder into a zip suitable for Chrome Web Store upload.
// The zip root must contain manifest.json directly (no wrapping "dist/" folder).
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'browsebuddy.zip');

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json not found. Run `npm run build` first.');
  process.exit(1);
}

// Remove any stale zip so zip -r doesn't append into it
if (existsSync(OUT)) rmSync(OUT);

// Collect files, skipping macOS metadata
const files = [];
function walk(dir, base = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    if (e.isDirectory()) {
      walk(path.join(dir, e.name), `${base}${e.name}/`);
    } else {
      files.push(path.join(dir, e.name));
    }
  }
}
walk(DIST);

const relPaths = files.map((f) => path.relative(DIST, f).split(path.sep).join('/'));
const fileList = path.join(ROOT, '.zip-filelist.txt');
writeFileSync(fileList, relPaths.join('\n') + '\n');

try {
  // Build the zip from inside dist so entries are relative to the zip root
  execSync(`zip -X -q "${OUT}" -@ < "${fileList}"`, { cwd: DIST, stdio: 'inherit' });
} finally {
  unlinkSync(fileList);
}

const size = statSync(OUT).size;
console.log(`Packaged ${files.length} files -> ${OUT} (${(size / 1024).toFixed(1)} KB)`);
console.log('Zip root contains manifest.json directly - ready for Chrome Web Store upload.');
