// Verifier-league driver. Reads every surfaces/<name>/surface.json manifest and
// renders one neutral league — the convergence the four repos always implied.
//
//   node run.mjs            # print the league
//   node run.mjs --html     # also write site/league.html
//
// This indexes the surfaces; each surface's own probe/verify scripts still run
// standalone from its directory (cd surfaces/vesper && node verify-cmls.mjs).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConsole, renderHtml } from './core/board.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const surfacesDir = join(root, 'surfaces');

const ORDER = { past: 0, present: 1, adversarial: 2 };

const surfaces = readdirSync(surfacesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(surfacesDir, d.name, 'surface.json'))
  .filter((p) => existsSync(p))
  .map((p) => JSON.parse(readFileSync(p, 'utf8')))
  .sort((a, b) => (ORDER[a.direction] ?? 9) - (ORDER[b.direction] ?? 9));

console.log(renderConsole(surfaces));

if (process.argv.includes('--html')) {
  const outDir = join(root, 'site');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'league.html');
  writeFileSync(out, renderHtml(surfaces));
  console.log(`\nwrote ${out}`);
}
