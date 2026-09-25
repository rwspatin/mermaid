/**
 * Regenerate the base-parser equivalence snapshot used by `bpmn.tolerant.spec.ts`.
 *
 * The tolerant-keywords work rewrote the BPMN lexer/parser. To prove it changed no canonical
 * parsing, that spec asserts every diagram in the corpus parses to the same `ParsedDiagram` as it
 * did on the base stack. This script produces that reference by running whatever `parseBpmn` is
 * checked out over the corpus — so run it on the BASE commit (the one recorded in the snapshot's
 * `baseCommit` field: upstream `pull/8167/head`, which carries the base parser and the docs):
 *
 *   git checkout <baseCommit>
 *   npx tsx packages/mermaid/scripts/bpmnBaseParseSnapshot.mts
 *
 * then check out the feature branch again. The committed JSON is the base output; the spec compares
 * the reworked parser against it (ignoring the added `line` field).
 */
/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBpmn } from '../src/diagrams/bpmn/parser/bpmn.parser.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mermaid = resolve(scriptDir, '..');
const repoRoot = resolve(mermaid, '../..');

const stripFrontmatter = (s: string): string =>
  s.startsWith('---') ? s.replace(/^---\r?\n[\S\s]*?\r?\n---\r?\n/, '') : s;
const extract = (markdown: string): string[] =>
  [...markdown.matchAll(/^```mermaid-example[^\n]*\r?\n([\S\s]*?)\r?\n```$/gm)].map(([, s]) => s);

const corpus: { name: string; source: string }[] = [];

const devDir = join(repoRoot, 'e2e/platform/dev-diagrams/diagrams/bpmn');
for (const file of readdirSync(devDir)
  .filter((n) => n.endsWith('.mmd'))
  .sort()) {
  corpus.push({ name: `dev/${file}`, source: readFileSync(join(devDir, file), 'utf8') });
}
for (const page of ['syntax/bpmn.md', 'syntax/bpmnElements.md']) {
  try {
    const md = readFileSync(join(mermaid, 'src/docs', page), 'utf8');
    extract(md).forEach((source, i) =>
      corpus.push({ name: `docs/${page}#${i + 1}`, source: stripFrontmatter(source) })
    );
  } catch {
    // page absent on this checkout
  }
}

const snapshot = {
  baseCommit: execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim(),
  generator: 'packages/mermaid/scripts/bpmnBaseParseSnapshot.mts',
  source: 'e2e dev-diagrams + mermaid-example blocks in docs/syntax/{bpmn,bpmnElements}.md',
  entries: corpus.map(({ name, source }) => ({ name, source, parsed: parseBpmn(source) })),
};

const target = join(mermaid, 'src/diagrams/bpmn/parser/__fixtures__/base-parse-snapshot.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`wrote ${snapshot.entries.length} entries from ${snapshot.baseCommit}`);
