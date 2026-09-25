import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBpmn } from './bpmn.parser.js';
import type { ParsedDiagram } from './bpmn.parser.js';

// The tolerant layer widens what a keyword may be typed as, but only in the keyword position —
// the first word of a declaration. It must never reserve a word anywhere else: any word can still
// be a node id, a flow endpoint or a label. So the contract is: a case variant or synonym in the
// keyword position parses to the same ParsedDiagram as the canonical form, and the very same word
// used as an id or a flow endpoint stays a literal identifier.

describe('bpmn tolerant keywords', () => {
  describe('case-insensitivity in the keyword position', () => {
    it.each([
      ['header', 'bpmn-beta LR\n  task t1 "T"\n', 'BPMN-BETA LR\n  task t1 "T"\n'],
      ['direction', 'bpmn-beta LR\n  task t1 "T"\n', 'bpmn-beta lr\n  task t1 "T"\n'],
      ['element keyword', 'bpmn-beta LR\n  task t1 "T"\n', 'bpmn-beta LR\n  TASK t1 "T"\n'],
      ['mixed case', 'bpmn-beta LR\n  task t1 "T"\n', 'bpmn-beta LR\n  Task t1 "T"\n'],
      [
        'trigger qualifier',
        'bpmn-beta LR\n  start message s1 "S"\n',
        'bpmn-beta LR\n  Start Message s1 "S"\n',
      ],
      ['task type', 'bpmn-beta LR\n  user task t1 "T"\n', 'bpmn-beta LR\n  USER TASK t1 "T"\n'],
    ])('parses %s the same whatever the case', (_label, canonical, variant) => {
      expect(parseBpmn(variant)).toEqual(parseBpmn(canonical));
    });
  });

  describe('synonyms in the keyword position', () => {
    it.each([
      ['participant', 'pool "P"', 'participant "P"'],
      ['swimlane', 'lane "L"', 'swimlane "L"'],
      ['begin', 'start s1 "S"', 'begin s1 "S"'],
      ['stop', 'end e1 "E"', 'stop e1 "E"'],
      ['activity', 'task t1 "T"', 'activity t1 "T"'],
      ['step', 'task t1 "T"', 'step t1 "T"'],
      ['exclusive', 'xor g1 "G"', 'exclusive g1 "G"'],
      ['decision', 'xor g1 "G"', 'decision g1 "G"'],
      ['parallel', 'and g1 "G"', 'parallel g1 "G"'],
      ['inclusive', 'or g1 "G"', 'inclusive g1 "G"'],
      ['event-based', 'event-gateway g1 "G"', 'event-based g1 "G"'],
      ['eventgateway', 'event-gateway g1 "G"', 'eventgateway g1 "G"'],
      ['datastore', 'data-store d1 "D"', 'datastore d1 "D"'],
      ['annotation', 'note n1 "N"', 'annotation n1 "N"'],
    ])('accepts %s as a synonym without changing the model', (_label, canonical, variant) => {
      const wrap = (statement: string) => `bpmn-beta LR\n  lane "L"\n    ${statement}\n`;
      expect(parseBpmn(wrap(variant))).toEqual(parseBpmn(wrap(canonical)));
    });
  });

  describe('flow-operator synonyms', () => {
    it('reads the unicode arrow as a sequence flow', () => {
      const canonical = 'bpmn-beta LR\n  task a "A"\n  task b "B"\n  a --> b\n';
      const variant = 'bpmn-beta LR\n  task a "A"\n  task b "B"\n  a → b\n';
      expect(parseBpmn(variant)).toEqual(parseBpmn(canonical));
    });

    it.each([['=>'], ['==>']])('reads %s as a message flow', (arrow) => {
      const canonical = 'bpmn-beta LR\n  task a "A"\n  task b "B"\n  a -.-> b\n';
      const variant = `bpmn-beta LR\n  task a "A"\n  task b "B"\n  a ${arrow} b\n`;
      expect(parseBpmn(variant)).toEqual(parseBpmn(canonical));
    });

    it('does not read a longer run of equals as a message flow', () => {
      // `={1,2}>` accepts only `=>` and `==>`, so `===>` is not a connector at all.
      expect(() => parseBpmn('bpmn-beta LR\n  task a "A"\n  task b "B"\n  a ===> b\n')).toThrow();
    });
  });

  // The core requirement of the rework: tolerance must not change identifier tokenization. A word
  // that looks like a keyword, a synonym or a direction is still a plain identifier everywhere
  // except the keyword position.
  describe('reserved-looking words stay usable as identifiers', () => {
    it.each([
      ['BEGIN'], // an upper-case canonical keyword
      ['begin'], // a lower-case synonym
      ['Start'], // a mixed-case canonical keyword
      ['lr'], // a direction
      ['td'], // a direction
      ['USER'], // a task type
      ['participant'], // a container synonym
      ['activity'], // a task synonym
      ['xor'], // a gateway keyword
      ['pool'], // a container keyword
      ['swimlane'], // a container synonym
      ['datastore'], // an artifact synonym
      ['beginner'], // a word that merely starts with a synonym
      ['datastore_x'],
    ])('uses %s as a node id', (id) => {
      const parsed = parseBpmn(`bpmn-beta LR\n  lane "L"\n    task ${id} "T"\n`);
      expect(parsed.nodes.at(-1)).toMatchObject({ id, kind: 'activity', label: 'T' });
    });

    it('uses keyword, synonym and direction words as flow endpoints', () => {
      const parsed = parseBpmn(
        'bpmn-beta LR\n  begin --> stop\n  lr --> td\n  participant ==> activity\n'
      );
      expect(parsed.flows).toEqual([
        { from: 'begin', to: 'stop', kind: 'sequence', label: undefined },
        { from: 'lr', to: 'td', kind: 'sequence', label: undefined },
        { from: 'participant', to: 'activity', kind: 'message', label: undefined },
      ]);
    });

    it('does not let a keyword swallow a longer word (the original guard)', () => {
      const parsed = parseBpmn('bpmn-beta LR\n  lane l1 "L"\n    data database "D"\n');
      expect(parsed.nodes.at(-1)).toMatchObject({ id: 'database', kind: 'data' });
    });

    it('keeps a title-like id an id', () => {
      const parsed = parseBpmn('bpmn-beta LR\n  lane l1 "L"\n    task titles "T"\n');
      expect(parsed.nodes.at(-1)?.id).toBe('titles');
      expect(parsed.title).toBeUndefined();
    });
  });

  // The negative-lookahead hack the lexer used for `parallel` is gone: `parallel` and
  // `parallel-multiple` are just words, resolved by position, so neither can shadow the other.
  it('reads the parallel-multiple trigger and a parallel gateway independently', () => {
    const trigger = parseBpmn('bpmn-beta LR\n  lane "L"\n    start parallel-multiple a7 "P"\n');
    expect(trigger.nodes.at(-1)).toMatchObject({
      kind: 'event',
      keyword: 'start',
      qualifier: 'parallel-multiple',
      id: 'a7',
    });
    const gateway = parseBpmn('bpmn-beta LR\n  lane "L"\n    parallel g1 "Fork"\n');
    expect(gateway.nodes.at(-1)).toMatchObject({ kind: 'gateway', keyword: 'and', id: 'g1' });
  });

  // A flow admits no trailing text. The contextual grammar must not silently drop it: anything
  // after a flow chain that is not part of the flow is a syntax error, as it was on the base stack.
  describe('a flow chain rejects trailing text', () => {
    it.each([
      ['a trailing declaration', 'bpmn-beta LR\n  a --> b task c\n'],
      ['a trailing quoted string', 'bpmn-beta LR\n  a --> b "ignored"\n'],
      ['a trailing word after the last target', 'bpmn-beta LR\n  a --> task b\n'],
    ])('%s is a syntax error', (_label, source) => {
      expect(() => parseBpmn(source)).toThrow();
    });
  });

  // Guard against any silent behaviour change from the lexer/parser rewrite: every diagram in the
  // dev-diagrams and the documentation examples must parse to the same ParsedDiagram as it did on
  // the base stack. The snapshot was generated by running the base `parseBpmn` over that corpus.
  describe('parses the whole example corpus identically to the base parser', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // Regenerate with packages/mermaid/scripts/bpmnBaseParseSnapshot.mts on `baseCommit`.
    const snapshot = JSON.parse(
      readFileSync(join(here, '__fixtures__/base-parse-snapshot.json'), 'utf8')
    ) as {
      baseCommit: string;
      entries: { name: string; source: string; parsed: ParsedDiagram }[];
    };

    // The `line` field is metadata added by this work; the base model did not carry it, so it is
    // ignored when comparing structure.
    const withoutLines = (parsed: ParsedDiagram): ParsedDiagram => ({
      ...parsed,
      nodes: parsed.nodes.map(({ line: _line, ...node }) => node) as ParsedDiagram['nodes'],
    });

    it('records the base commit it was generated from', () => {
      expect(snapshot.baseCommit).toMatch(/^[\da-f]{40}$/);
      expect(snapshot.entries.length).toBeGreaterThan(20);
    });

    it.each(snapshot.entries.map((entry) => [entry.name, entry] as const))(
      '%s parses to the base model',
      (_name, entry) => {
        expect(withoutLines(parseBpmn(entry.source))).toEqual(withoutLines(entry.parsed));
      }
    );
  });
});
