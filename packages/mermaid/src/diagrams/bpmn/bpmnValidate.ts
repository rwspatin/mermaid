import { parseBpmn } from './parser/bpmn.parser.js';
import type { ParsedDiagram, ParsedFlow, ParsedNode } from './parser/bpmn.parser.js';

/**
 * Semantic validation for a parsed BPMN diagram — the "AI-first" layer.
 *
 * This is **opt-in** and internal. It never blocks rendering on its own: by default a diagram
 * renders exactly as it does on the base `bpmn-beta` stack. It runs only when a document sets
 * `bpmn.strict: true`, in which case `db.parse` throws one error listing every violation, the way
 * a parse error does. It is not part of Mermaid's public API.
 *
 * Every message names the offending id (or line), states the rule, and gives a concrete,
 * copy-and-paste fix. Rules are adapted to the `bpmn-beta` model, which supports boundary events,
 * sub-processes, event-based gateways, groups and top-level lanes; rules that would false-positive
 * on that model are deliberately omitted (see the notes below).
 */

// ---- small helpers ----------------------------------------------------------

const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
};

const didYouMean = (id: string, known: string[]): string => {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const candidate of known) {
    const dist = levenshtein(id.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best !== undefined && bestDist <= 2 ? ` — did you mean '${best}'?` : '';
};

const ARTIFACT_KINDS = new Set<ParsedNode['kind']>(['data', 'store', 'annotation']);
const CONTAINER_KINDS = new Set<ParsedNode['kind']>(['pool', 'lane', 'group']);

/** A flow node takes part in the sequence flow: events, gateways, activities. */
const isFlowNode = (node: ParsedNode): boolean =>
  !ARTIFACT_KINDS.has(node.kind) && !CONTAINER_KINDS.has(node.kind);

const isStart = (n: ParsedNode) => n.kind === 'event' && n.keyword === 'start';
const isEnd = (n: ParsedNode) => n.kind === 'event' && n.keyword === 'end';
const isBoundary = (n: ParsedNode) => n.kind === 'event' && n.keyword === 'boundary';

/**
 * Collect every semantic violation in a parsed diagram. Pure — it never throws and never renders.
 */
export function collectViolations(diagram: ParsedDiagram): string[] {
  const errors: string[] = [];
  const nodeById = new Map<string, ParsedNode>();
  const seenIds = new Map<string, number | undefined>();

  // Unique ids — also builds the id index used below.
  for (const node of diagram.nodes) {
    if (seenIds.has(node.id)) {
      const firstLine = seenIds.get(node.id);
      const where = firstLine ? ` (first declared on line ${firstLine})` : '';
      errors.push(
        `bpmn: duplicate id '${node.id}'${where}. Ids must be unique. Rename one, e.g. '${node.id}b'.`
      );
      continue;
    }
    seenIds.set(node.id, node.line);
    nodeById.set(node.id, node);
  }
  const knownIds = [...nodeById.keys()];

  // Every flow references a declared id.
  const validFlows: ParsedFlow[] = [];
  for (const flow of diagram.flows) {
    const src = nodeById.get(flow.from);
    const dst = nodeById.get(flow.to);
    if (!src) {
      errors.push(
        `bpmn: flow references unknown node '${flow.from}'. Declare it, e.g. 'task ${flow.from} "..."', or fix the id${didYouMean(flow.from, knownIds)}.`
      );
    }
    if (!dst) {
      errors.push(
        `bpmn: flow references unknown node '${flow.to}'. Declare it, e.g. 'task ${flow.to} "..."', or fix the id${didYouMean(flow.to, knownIds)}.`
      );
    }
    if (src && dst) {
      validFlows.push(flow);
    }
  }

  const sequenceFlows = validFlows.filter((flow) => flow.kind === 'sequence');
  const messageFlows = validFlows.filter((flow) => flow.kind === 'message');

  // Start/end flow direction. A start begins a process (no incoming sequence flow); an end
  // terminates a path (no outgoing sequence flow). Message flows to/from them are fine.
  const incomingSeq = new Map<string, ParsedFlow[]>();
  const outgoingSeq = new Map<string, ParsedFlow[]>();
  for (const flow of sequenceFlows) {
    (outgoingSeq.get(flow.from) ?? outgoingSeq.set(flow.from, []).get(flow.from)!).push(flow);
    (incomingSeq.get(flow.to) ?? incomingSeq.set(flow.to, []).get(flow.to)!).push(flow);
  }
  for (const node of diagram.nodes) {
    if (isStart(node) && (incomingSeq.get(node.id)?.length ?? 0) > 0) {
      const from = incomingSeq.get(node.id)![0].from;
      errors.push(
        `bpmn: start event '${node.id}' has an incoming sequence flow from '${from}'. Start events begin a process and cannot be a flow target. Use an 'intermediate' event here, or make '${node.id}' a task.`
      );
    }
    if (isEnd(node) && (outgoingSeq.get(node.id)?.length ?? 0) > 0) {
      const to = outgoingSeq.get(node.id)![0].to;
      errors.push(
        `bpmn: end event '${node.id}' has an outgoing sequence flow to '${to}'. End events terminate a path and cannot have outgoing flows. Use an 'intermediate' event, or move the flow to start from an earlier node.`
      );
    }
  }

  // Pool crossing. Message flows cross pool boundaries; sequence flows stay inside one pool. A node
  // with no pool (a top-level lane, which bpmn-beta allows) is exempt — crossing is only defined
  // between two pooled nodes.
  const poolOf = (node: ParsedNode): ParsedNode | undefined => {
    let cursor = node.parentId;
    while (cursor) {
      const parent = nodeById.get(cursor);
      if (!parent) {
        break;
      }
      if (parent.kind === 'pool') {
        return parent;
      }
      cursor = parent.parentId;
    }
    return undefined;
  };
  for (const flow of messageFlows) {
    const srcPool = poolOf(nodeById.get(flow.from)!);
    const dstPool = poolOf(nodeById.get(flow.to)!);
    if (srcPool && dstPool && srcPool.id === dstPool.id) {
      errors.push(
        `bpmn: message flow '${flow.from} ==> ${flow.to}' connects two nodes in the same pool '${srcPool.label}'. Message flows may only cross pool boundaries. Use a sequence flow '-->' within a pool, or move one endpoint to another pool.`
      );
    }
  }
  for (const flow of sequenceFlows) {
    const srcPool = poolOf(nodeById.get(flow.from)!);
    const dstPool = poolOf(nodeById.get(flow.to)!);
    if (srcPool && dstPool && srcPool.id !== dstPool.id) {
      errors.push(
        `bpmn: sequence flow '${flow.from} --> ${flow.to}' crosses from pool '${srcPool.label}' to pool '${dstPool.label}'. Sequence flows stay inside one pool. Use a message flow '==>' between pools.`
      );
    }
  }

  // Reachability — per connected component of the sequence-flow graph. A component that names at
  // least one start or end event is an explicit process fragment and is checked; a component with
  // neither is an implicit fragment (a snippet, or a black-box participant) and is left alone, so
  // two unrelated fragments in one lane never fault each other. Boundary events are triggered by
  // their host, not by a sequence flow, so they seed the "reachable from a start" set and are
  // themselves exempt from it.
  const flowNodes = diagram.nodes.filter(isFlowNode);
  const flowNodeIds = new Set(flowNodes.map((n) => n.id));

  const undirected = new Map<string, Set<string>>();
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const id of flowNodeIds) {
    undirected.set(id, new Set());
  }
  for (const flow of sequenceFlows) {
    if (!flowNodeIds.has(flow.from) || !flowNodeIds.has(flow.to)) {
      continue;
    }
    undirected.get(flow.from)!.add(flow.to);
    undirected.get(flow.to)!.add(flow.from);
    (forward.get(flow.from) ?? forward.set(flow.from, []).get(flow.from)!).push(flow.to);
    (backward.get(flow.to) ?? backward.set(flow.to, []).get(flow.to)!).push(flow.from);
  }

  const reachSet = (starts: string[], graph: Map<string, string[]>): Set<string> => {
    const seen = new Set<string>(starts);
    const stack = [...starts];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of graph.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };

  const seenComponent = new Set<string>();
  for (const root of flowNodeIds) {
    if (seenComponent.has(root)) {
      continue;
    }
    // Gather this connected component (undirected walk).
    const component: ParsedNode[] = [];
    const stack = [root];
    seenComponent.add(root);
    while (stack.length) {
      const id = stack.pop()!;
      component.push(nodeById.get(id)!);
      for (const neighbour of undirected.get(id) ?? []) {
        if (!seenComponent.has(neighbour)) {
          seenComponent.add(neighbour);
          stack.push(neighbour);
        }
      }
    }

    const startIds = component.filter(isStart).map((n) => n.id);
    const endIds = component.filter(isEnd).map((n) => n.id);
    const boundaryIds = component.filter(isBoundary).map((n) => n.id);

    // No explicit start or end anywhere in the component → an implicit, valid fragment.
    if (startIds.length === 0 && endIds.length === 0) {
      continue;
    }

    if (endIds.length > 0) {
      const canReachEnd = reachSet(endIds, backward);
      for (const node of component) {
        if (isEnd(node) || canReachEnd.has(node.id)) {
          continue;
        }
        errors.push(
          `bpmn: node '${node.id}' has no path to an end event. In BPMN every flow node must reach at least one end event. Add an outgoing sequence flow from '${node.id}', e.g. '${node.id} --> ${endIds[0]}', or connect it to an existing node that already reaches an end.`
        );
      }
    }

    if (startIds.length > 0) {
      const reachable = reachSet([...startIds, ...boundaryIds], forward);
      for (const node of component) {
        if (isStart(node) || isBoundary(node) || reachable.has(node.id)) {
          continue;
        }
        errors.push(
          `bpmn: node '${node.id}' is unreachable — no start event leads to it. Add an incoming sequence flow, e.g. '${startIds[0]} --> ${node.id}', or remove '${node.id}'.`
        );
      }
    }
  }

  return errors;
}

/**
 * Internal helper: parse `text` and return every semantic violation as a plain string. If the text
 * cannot be parsed at all (a syntax or trigger error), that single message is returned instead.
 * Never throws. Not exported from the package — `bpmn.strict` is the supported entry point.
 */
export function validateBpmn(text: string): string[] {
  let diagram: ParsedDiagram;
  try {
    diagram = parseBpmn(text);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return collectViolations(diagram);
}
