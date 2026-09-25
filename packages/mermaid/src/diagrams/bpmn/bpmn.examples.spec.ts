import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBpmn } from './bpmnValidate.js';

// The point of the validator is that it never fires on a correct diagram. This guards that against
// regression by running every one of the shipped bpmn-beta example diagrams — the dev-diagrams the
// demo ships — through the catalogue and asserting zero violations. If a future rule is too eager,
// one of these fixtures lights up and this test fails first.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../../');
const examplesDir = join(repoRoot, 'e2e/platform/dev-diagrams/diagrams/bpmn');

const exampleFiles = readdirSync(examplesDir).filter((name) => name.endsWith('.mmd'));

describe('bpmn-beta example diagrams pass validation with zero false positives', () => {
  it('finds the shipped example diagrams', () => {
    expect(exampleFiles.length).toBeGreaterThan(0);
  });

  it.each(exampleFiles)('%s reports no semantic violations', (name) => {
    const source = readFileSync(join(examplesDir, name), 'utf8');
    expect(validateBpmn(source)).toEqual([]);
  });
});
