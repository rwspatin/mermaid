import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseBpmn } from './parser/bpmn.parser.js';
import { collectViolations, validateBpmn } from './bpmnValidate.js';
import { db } from './bpmnDb.js';
import { addDiagrams } from '../../diagram-api/diagram-orchestration.js';
import { mermaidAPI } from '../../mermaidAPI.js';
import { saveConfigFromInitialize, setSiteConfig, reset } from '../../config.js';

const check = (src: string): string[] => collectViolations(parseBpmn(src));

describe('bpmn semantic validation — self-correcting error catalogue', () => {
  describe('reachability (per connected component)', () => {
    it('flags a node with no path to an end event', () => {
      const msgs = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    task t1 "Dead end"
    end e1 "E"
  s1 --> t1
  s1 --> e1`);
      expect(msgs.join('\n')).toContain("node 't1' has no path to an end event");
    });

    it('flags a node unreachable from a start event', () => {
      const msgs = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    task t1 "Island"
    end e1 "E"
  s1 --> e1
  t1 --> e1`);
      expect(msgs.join('\n')).toContain("node 't1' is unreachable — no start event leads to it");
    });

    it('does not fault one fragment for another in the same scope (implicit fragments)', () => {
      // Two independent connected components share a lane. The {s,e} fragment has a start and end;
      // the {a,b} fragment has neither, so it is an implicit fragment and must not be flagged.
      expect(
        check(`bpmn-beta LR
  lane "L"
    start s "S"
    end e "E"
    task a "A"
    task b "B"
  s --> e
  a --> b`)
      ).toEqual([]);
    });

    it('scopes a boundary event on a sub-process to the enclosing process, not the sub-process', () => {
      // b hangs off the sub-process sp; its exception path b --> e belongs to the outer process,
      // so it must not be asked to reach the sub-process's own end se.
      expect(
        check(`bpmn-beta LR
  pool "P"
    start s "S"
    subprocess sp "Work"
      start ss "S2"
      task t "T"
      end se "E2"
      boundary timer b "Timeout"
    end e "E"
  s --> sp --> e
  ss --> t --> se
  b --> e`)
      ).toEqual([]);
    });

    it('does not flag a black-box participant that has no sequence flow of its own', () => {
      expect(
        check(`bpmn-beta LR
  pool "Customer"
    lane "Buyer"
      start c1 "Places order"
      end c2 "Receives goods"
  pool "Supplier"
    lane "Sales"
      task t1 "Receive order"
      end e1 "Done"
  c1 -.-> t1
  t1 --> e1
  t1 -.-> c2`)
      ).toEqual([]);
    });
  });

  describe('start / end flow rules', () => {
    it('flags a start event with an incoming sequence flow', () => {
      const msgs = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    task t1 "T"
    end e1 "E"
  s1 --> t1 --> e1
  t1 --> s1`);
      expect(msgs.join('\n')).toContain("start event 's1' has an incoming sequence flow");
    });

    it('flags an end event with an outgoing sequence flow', () => {
      const msgs = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    end e1 "E"
    end e2 "E2"
  s1 --> e1
  e1 --> e2`);
      expect(msgs.join('\n')).toContain("end event 'e1' has an outgoing sequence flow");
    });
  });

  describe('pool crossing', () => {
    it('flags a message flow within the same pool', () => {
      const msgs = check(`bpmn-beta LR
  pool "P"
    lane "L"
      start s1 "S"
      task t1 "T"
      end e1 "E"
  s1 --> t1 --> e1
  s1 -.-> t1`);
      expect(msgs.join('\n')).toContain("connects two nodes in the same pool 'P'");
    });

    it('flags a sequence flow that crosses pools', () => {
      const msgs = check(`bpmn-beta LR
  pool "A"
    lane "La"
      start s1 "S"
      end e1 "E"
  pool "B"
    lane "Lb"
      task t1 "T"
  s1 --> e1
  s1 --> t1`);
      expect(msgs.join('\n')).toContain("crosses from pool 'A' to pool 'B'");
    });
  });

  describe('ids', () => {
    it('flags an unknown node reference with a suggestion', () => {
      const joined = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    end e1 "E"
  s1 --> e2`).join('\n');
      expect(joined).toContain("flow references unknown node 'e2'");
      expect(joined).toContain("did you mean 'e1'");
    });

    it('flags a duplicate id and names the first line', () => {
      const msgs = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    task s1 "dup"
    end e1 "E"
  s1 --> e1`);
      expect(msgs.join('\n')).toContain("duplicate id 's1' (first declared on line 3)");
    });
  });

  // A flow label is presentation only; the grammar cannot tell a name from a condition. So a label
  // on a parallel-gateway branch, or on any non-gateway flow, is NOT a violation.
  describe('flow labels are never treated as conditions', () => {
    it('accepts a named branch out of a parallel gateway', () => {
      expect(
        check(`bpmn-beta LR
  lane "L"
    start s "S"
    and g "Fork"
    task notify "Notify"
    task ship "Ship"
    end e "E"
  s --> g
  g -- notify customer --> notify
  g -- ship goods --> ship
  notify --> e
  ship --> e`)
      ).toEqual([]);
    });

    it('accepts a label on a flow leaving a task', () => {
      expect(
        check(`bpmn-beta LR
  lane "L"
    start s "S"
    task t "T"
    end e "E"
  s --> t
  t -- done --> e`)
      ).toEqual([]);
    });
  });

  describe('rules that do not fit the bpmn-beta model are not ported', () => {
    it('does not require a lane to sit inside a pool (top-level lanes are valid here)', () => {
      expect(
        check(`bpmn-beta TB
  lane "Catching events"
    start message a1 "Message"
    start timer a2 "Timer"`)
      ).toEqual([]);
    });

    it('does not flag a single-branch diverging gateway', () => {
      expect(
        check(`bpmn-beta LR
  lane "L"
    start message s1 "In"
    user task t1 "Review"
    xor gw "Approved?"
    end e1 "Done"
  s1 --> t1 --> gw --> e1`)
      ).toEqual([]);
    });
  });

  it('collects every violation rather than stopping at the first', () => {
    const joined = check(`bpmn-beta LR
  lane "L"
    start s1 "S"
    task t1 "T"
    task t1 "dup"
    end e1 "E"
  s1 --> t1 --> e1
  t1 --> s1`).join('\n');
    expect(joined).toContain("duplicate id 't1'");
    expect(joined).toContain("start event 's1' has an incoming sequence flow");
  });

  describe('the exported validateBpmn(text) helper', () => {
    it('returns the violations for a diagram it can parse', () => {
      const msgs = validateBpmn(
        'bpmn-beta LR\n  lane "L"\n    start s1 "S"\n    end e1 "E"\n  s1 --> e2'
      );
      expect(msgs.join('\n')).toContain("flow references unknown node 'e2'");
    });

    it('returns an empty list for a well-formed diagram', () => {
      expect(
        validateBpmn(`bpmn-beta LR
  pool "Shop"
    lane "Sales"
      start message s1 "Order received"
      xor g1 "Approved?"
      user task t2 "Charge card"
      end e1 "Shipped"
      end e2 "Rejected"
  s1 --> g1
  g1 -- approved --> t2 --> e1
  g1 -- rejected --> e2`)
      ).toEqual([]);
    });

    it('reports a parse or trigger error as the single message, without throwing', () => {
      expect(validateBpmn('bpmn-beta LR\n  lane "L"\n    start terminate s1 "S"')).toEqual([
        expect.stringContaining('a start event cannot carry the terminate trigger'),
      ]);
    });
  });
});

// Validation is reached through the public parse path (`mermaid.parse`, i.e. `mermaidAPI.parse`)
// only when strict mode is on — set globally or in a diagram's frontmatter. There is no new public
// API: `validateBpmn` stays an internal helper.
describe('bpmn validation is opt-in, through the public parse path', () => {
  beforeEach(() => {
    addDiagrams();
    saveConfigFromInitialize({});
    setSiteConfig({});
    reset();
  });
  afterEach(() => {
    reset();
    db.clear();
  });

  const INVALID = 'bpmn-beta LR\n  lane "L"\n    start s1 "S"\n    end e1 "E"\n  s1 --> e2';

  it('does not block rendering by default — behaviour matches the base stack', async () => {
    await expect(mermaidAPI.parse(INVALID)).resolves.toBeTruthy();
  });

  it('fails mermaid.parse when bpmn.strict is set globally', async () => {
    mermaidAPI.initialize({ bpmn: { strict: true } });
    await expect(mermaidAPI.parse(INVALID)).rejects.toThrow("flow references unknown node 'e2'");
  });

  it('fails mermaid.parse when bpmn.strict is set in the diagram frontmatter', async () => {
    const withFrontmatter = `---\nconfig:\n  bpmn:\n    strict: true\n---\n${INVALID}`;
    await expect(mermaidAPI.parse(withFrontmatter)).rejects.toThrow(
      "flow references unknown node 'e2'"
    );
  });
});
