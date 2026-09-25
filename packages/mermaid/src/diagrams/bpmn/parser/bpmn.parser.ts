import { CstParser, Lexer } from 'chevrotain';
import type { CstNode, IToken } from 'chevrotain';
import * as t from './bpmn.tokens.js';
import { bpmnTokens } from './bpmn.tokens.js';
import {
  BPMN_DIRECTIONS,
  EVENT_TRIGGERS,
  KEYWORD_SYNONYMS,
  TASK_TYPES,
  TRIGGERS_BY_POSITION,
  positionsFor,
} from '../types.js';

const listOf = (items: string[]): string =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items[0];

class BpmnParser extends CstParser {
  constructor() {
    super(t.bpmnTokens, { recoveryEnabled: false });
    this.performSelfAnalysis();
  }

  public diagram = this.RULE('diagram', () => {
    this.MANY(() => this.CONSUME(t.Newline));
    this.OPTION(() => this.CONSUME(t.Indent));
    this.CONSUME(t.Header);
    // The direction is just a word; the visitor checks it is a real direction.
    this.OPTION2(() => this.CONSUME(t.Identifier));
    this.MANY2(() => this.SUBRULE(this.line));
  });

  private line = this.RULE('line', () => {
    this.AT_LEAST_ONE(() => this.CONSUME(t.Newline));
    this.OPTION(() => this.CONSUME(t.Indent));
    this.OPTION2(() => this.SUBRULE(this.statement));
  });

  // A statement is either a meta line (its own distinct tokens) or a line that opens with a
  // word — which becomes either a declaration or a flow depending on what follows the word.
  private statement = this.RULE('statement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.meta) },
      { ALT: () => this.SUBRULE(this.identifierStatement) },
    ]);
  });

  private identifierStatement = this.RULE('identifierStatement', () => {
    this.CONSUME(t.Identifier);
    // A connector right after the first word makes the line a flow; otherwise the remaining words
    // (and an optional quoted label) make it a declaration. The two alternatives begin with
    // disjoint tokens (a connector vs. a word / string / nothing), so the choice is unambiguous —
    // and a flow admits no trailing words, so `a --> b task c` is a syntax error, not a silent drop.
    this.OR([
      { ALT: () => this.SUBRULE(this.flowTail) },
      {
        ALT: () => {
          this.MANY(() => this.CONSUME2(t.Identifier));
          this.OPTION(() => this.CONSUME(t.QuotedString));
        },
      },
    ]);
  });

  private flowTail = this.RULE('flowTail', () => {
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.LabelledArrow) },
        { ALT: () => this.CONSUME(t.MessageArrow) },
        { ALT: () => this.CONSUME(t.Arrow) },
        { ALT: () => this.CONSUME(t.AssociationArrow) },
        { ALT: () => this.CONSUME(t.AssociationLine) },
      ]);
      this.CONSUME(t.Identifier);
    });
  });

  private meta = this.RULE('meta', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.Title) },
      { ALT: () => this.CONSUME(t.AccTitle) },
      { ALT: () => this.CONSUME(t.AccDescrMultiline) },
      { ALT: () => this.CONSUME(t.AccDescr) },
    ]);
  });
}

export const bpmnParser = new BpmnParser();
export const BpmnBaseVisitor = bpmnParser.getBaseCstVisitorConstructorWithDefaults();

export const bpmnLexer = new Lexer(bpmnTokens, { positionTracking: 'onlyStart' });

export interface ParsedNode {
  kind:
    | 'pool'
    | 'lane'
    | 'group'
    | 'event'
    | 'gateway'
    | 'activity'
    | 'data'
    | 'store'
    | 'annotation';

  keyword: string;

  qualifier?: string;
  id: string;
  label: string;
  level: number;
  parentId?: string;
}

export interface ParsedFlow {
  from: string;
  to: string;
  label?: string;
  kind: 'sequence' | 'message' | 'association';

  directed?: boolean;
}

export interface ParsedDiagram {
  direction: string;
  nodes: ParsedNode[];
  flows: ParsedFlow[];
  title?: string;
  accTitle?: string;
  accDescr?: string;
}

const imageOf = (token?: IToken) => token?.image ?? '';

const arrowLabel = (image: string) => image.replace(/^--/, '').replace(/-+>$/, '').trim();

const byOffset = (a: IToken, b: IToken) => (a.startOffset ?? 0) - (b.startOffset ?? 0);

// ---- keyword resolution (by position, case-insensitive, synonym-tolerant) ------------------
// Every accepted word — canonical or synonym — maps to the one canonical keyword the visitor
// emits. Built once from the KEYWORD_SYNONYMS table.
const CANONICAL = new Map<string, string>();
for (const [canonical, synonyms] of Object.entries(KEYWORD_SYNONYMS)) {
  CANONICAL.set(canonical, canonical);
  for (const synonym of synonyms) {
    CANONICAL.set(synonym, canonical);
  }
}
const DIRECTIONS = new Set<string>(BPMN_DIRECTIONS);
const TRIGGERS = new Set<string>(EVENT_TRIGGERS);
const TASK_TYPE_SET = new Set<string>(TASK_TYPES);
const CONTAINER_KEYWORDS = new Set(['pool', 'lane', 'group']);
const EVENT_KEYWORDS = new Set(['start', 'intermediate', 'boundary', 'end', 'throw']);
const GATEWAY_KEYWORDS = new Set(['xor', 'and', 'or', 'event-gateway', 'complex']);
const ACTIVITY_KEYWORDS = new Set(['task', 'subprocess', 'call']);
const ARTIFACT_KEYWORDS = new Set([
  'data-store',
  'data-collection',
  'data-input',
  'data-output',
  'data',
  'note',
]);

class BpmnVisitor extends BpmnBaseVisitor {
  private nodes: ParsedNode[] = [];
  private flows: ParsedFlow[] = [];
  private direction = 'LR';
  private title: string | undefined;
  private accTitle: string | undefined;
  private accDescr: string | undefined;
  private generated = 0;

  private baseLevel: number | undefined;

  constructor() {
    super();
    this.validateVisitor();
  }

  public reset() {
    this.nodes = [];
    this.flows = [];
    this.direction = 'LR';
    this.title = undefined;
    this.accTitle = undefined;
    this.accDescr = undefined;
    this.generated = 0;
    this.baseLevel = undefined;
  }

  public result(): ParsedDiagram {
    return {
      direction: this.direction,
      nodes: this.nodes,
      flows: this.flows,
      ...(this.title ? { title: this.title } : {}),
      ...(this.accTitle ? { accTitle: this.accTitle } : {}),
      ...(this.accDescr ? { accDescr: this.accDescr } : {}),
    };
  }

  public diagram(ctx: Record<string, CstNode[] | IToken[]>) {
    const direction = (ctx.Identifier as IToken[] | undefined)?.[0];
    if (direction) {
      const upper = direction.image.toUpperCase();
      if (!DIRECTIONS.has(upper)) {
        throw new Error(
          `BPMN parse error at line ${direction.startLine ?? '?'}: '${direction.image}' is not a direction (use ${listOf([...BPMN_DIRECTIONS])}).`
        );
      }
      this.direction = upper;
    }
    for (const line of (ctx.line as CstNode[] | undefined) ?? []) {
      this.visit(line);
    }
    this.assignParents();
  }

  public line(ctx: Record<string, CstNode[] | IToken[]>) {
    const indent = (ctx.Indent as IToken[] | undefined)?.[0];
    const level = indent ? indent.image.length : 0;
    const statement = (ctx.statement as CstNode[] | undefined)?.[0];
    if (!statement) {
      return;
    }
    const result = this.visit(statement) as { type: 'node'; node: ParsedNode } | { type: string };
    if (result?.type === 'node') {
      const { node } = result as { node: ParsedNode };
      this.baseLevel ??= level;
      node.level = Math.max(0, level - this.baseLevel);
      this.nodes.push(node);
    }
  }

  public statement(ctx: Record<string, CstNode[]>) {
    if (ctx.meta) {
      this.visit(ctx.meta[0]);
      return { type: 'meta' as const };
    }
    return this.visit(ctx.identifierStatement[0]);
  }

  public identifierStatement(ctx: Record<string, CstNode[] | IToken[]>) {
    const words = [...((ctx.Identifier as IToken[]) ?? [])].sort(byOffset);
    const flowTail = (ctx.flowTail as CstNode[] | undefined)?.[0];
    if (flowTail) {
      const { connectors, ids } = this.visit(flowTail) as {
        connectors: IToken[];
        ids: IToken[];
      };
      this.buildFlows(words[0], connectors, ids);
      return { type: 'flows' as const };
    }
    const quoted = (ctx.QuotedString as IToken[] | undefined)?.[0];
    return { type: 'node' as const, node: this.buildDeclaration(words, quoted) };
  }

  public flowTail(ctx: Record<string, IToken[]>) {
    const connectors = [
      ...(ctx.LabelledArrow ?? []),
      ...(ctx.MessageArrow ?? []),
      ...(ctx.Arrow ?? []),
      ...(ctx.AssociationArrow ?? []),
      ...(ctx.AssociationLine ?? []),
    ].sort(byOffset);
    const ids = [...(ctx.Identifier ?? [])].sort(byOffset);
    return { connectors, ids };
  }

  public meta(ctx: Record<string, IToken[]>) {
    const after = (image: string, keyword: string) =>
      image
        .slice(keyword.length)
        .replace(/^[\t :]+/, '')
        .trim();
    const title = ctx.Title?.[0];
    if (title) {
      this.title = after(imageOf(title), 'title');
    }
    const accTitle = ctx.AccTitle?.[0];
    if (accTitle) {
      this.accTitle = after(imageOf(accTitle), 'accTitle');
    }
    const accDescr = ctx.AccDescr?.[0];
    if (accDescr) {
      this.accDescr = after(imageOf(accDescr), 'accDescr');
    }
    const braced = ctx.AccDescrMultiline?.[0];
    if (braced) {
      this.accDescr = imageOf(braced)
        .replace(/^accDescr[\t ]*{/, '')
        .replace(/}$/, '')
        .trim();
    }
  }

  private buildFlows(source: IToken, connectors: IToken[], targets: IToken[]) {
    const ids = [source, ...targets];
    for (const [index, connector] of connectors.entries()) {
      const from = ids[index];
      const to = ids[index + 1];
      if (!from || !to) {
        break;
      }
      const name = connector.tokenType.name;
      const isAssociation = name === 'AssociationArrow' || name === 'AssociationLine';
      this.flows.push({
        from: from.image,
        to: to.image,
        kind: isAssociation ? 'association' : name === 'MessageArrow' ? 'message' : 'sequence',
        ...(isAssociation ? { directed: name === 'AssociationArrow' } : {}),
        label: name === 'LabelledArrow' ? arrowLabel(connector.image) : undefined,
      });
    }
  }

  private buildDeclaration(words: IToken[], quoted?: IToken): ParsedNode {
    const first = words[0];
    const w0 = first.image.toLowerCase();
    const label = quoted ? quoted.image.slice(1, -1) : '';
    const line = first.startLine;

    const make = (
      kind: ParsedNode['kind'],
      keyword: string,
      idToken?: IToken,
      qualifier?: string
    ): ParsedNode => {
      const idImage = idToken ? idToken.image : '';
      const id = idImage || `${keyword}-${++this.generated}`;
      const node: ParsedNode = { kind, keyword, id, label: label || idImage || '', level: 0 };
      if (qualifier) {
        node.qualifier = qualifier;
      }
      return node;
    };

    const tooMany = (max: number) => {
      if (words.length > max) {
        throw new Error(
          `BPMN parse error at line ${line ?? '?'}: '${words.map((w) => w.image).join(' ')}' has more words than a ${w0} statement takes.`
        );
      }
    };

    // A task type opens an activity: `user task t1`.
    if (TASK_TYPE_SET.has(w0)) {
      const activityKeyword = words[1] ? CANONICAL.get(words[1].image.toLowerCase()) : undefined;
      if (!activityKeyword || !ACTIVITY_KEYWORDS.has(activityKeyword)) {
        throw new Error(
          `BPMN parse error at line ${line ?? '?'}: '${first.image}' must be followed by task, subprocess or call.`
        );
      }
      tooMany(3);
      return make('activity', activityKeyword, words[2], w0);
    }

    const canonical = CANONICAL.get(w0);
    if (!canonical) {
      throw new Error(
        `BPMN parse error at line ${line ?? '?'}: '${first.image}' is not a BPMN element keyword.`
      );
    }

    if (CONTAINER_KEYWORDS.has(canonical)) {
      tooMany(2);
      return make(canonical as ParsedNode['kind'], canonical, words[1]);
    }
    if (GATEWAY_KEYWORDS.has(canonical)) {
      tooMany(2);
      return make('gateway', canonical, words[1]);
    }
    if (ACTIVITY_KEYWORDS.has(canonical)) {
      tooMany(2);
      return make('activity', canonical, words[1]);
    }
    if (EVENT_KEYWORDS.has(canonical)) {
      let qualifier: string | undefined;
      let idToken = words[1];
      if (words[1] && TRIGGERS.has(words[1].image.toLowerCase())) {
        qualifier = words[1].image.toLowerCase();
        idToken = words[2];
        tooMany(3);
      } else {
        tooMany(2);
      }
      const node = make('event', canonical, idToken, qualifier);
      this.checkTrigger(canonical, qualifier ?? 'none', first);
      return node;
    }
    if (!ARTIFACT_KEYWORDS.has(canonical)) {
      throw new Error(
        `BPMN parse error at line ${line ?? '?'}: '${first.image}' is not a BPMN element keyword.`
      );
    }
    tooMany(2);
    if (canonical === 'data-store') {
      return make('store', 'data-store', words[1]);
    }
    if (canonical === 'note') {
      return make('annotation', 'note', words[1]);
    }
    const qualifier =
      canonical === 'data-input'
        ? 'input'
        : canonical === 'data-output'
          ? 'output'
          : canonical === 'data-collection'
            ? 'collection'
            : undefined;
    return make('data', 'data', words[1], qualifier);
  }

  private checkTrigger(keyword: string, trigger: string, at?: IToken): void {
    const allowed = TRIGGERS_BY_POSITION[keyword as keyof typeof TRIGGERS_BY_POSITION] as
      | readonly string[]
      | undefined;
    if (!allowed || allowed.includes(trigger)) {
      return;
    }
    const where = `at line ${at?.startLine ?? '?'}`;
    if (trigger === 'none') {
      throw new Error(`BPMN error ${where}: a ${keyword} event must name what triggers it.`);
    }
    const positions = positionsFor(trigger);
    const instead = positions.length
      ? ` The notation draws ${trigger} on ${listOf(positions)} events.`
      : '';
    throw new Error(
      `BPMN error ${where}: a ${keyword} event cannot carry the ${trigger} trigger.${instead}`
    );
  }

  private assignParents() {
    for (const [index, node] of this.nodes.entries()) {
      for (let back = index - 1; back >= 0; back--) {
        if (this.nodes[back].level < node.level) {
          node.parentId = this.nodes[back].id;
          break;
        }
      }
    }
  }
}

const visitor = new BpmnVisitor();

export function parseBpmn(input: string): ParsedDiagram {
  const lexed = bpmnLexer.tokenize(input);
  if (lexed.errors.length > 0) {
    const first = lexed.errors[0];
    throw new Error(`BPMN lexing error at line ${first.line ?? '?'}: ${first.message}`);
  }
  bpmnParser.input = lexed.tokens;
  const cst = bpmnParser.diagram();
  if (bpmnParser.errors.length > 0) {
    const first = bpmnParser.errors[0];
    throw new Error(`BPMN parse error at line ${first.token?.startLine ?? '?'}: ${first.message}`);
  }
  visitor.reset();
  visitor.visit(cst);
  return visitor.result();
}
