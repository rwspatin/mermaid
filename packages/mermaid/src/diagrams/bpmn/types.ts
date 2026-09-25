export const BPMN_DIRECTIONS = ['LR', 'RL', 'TB', 'TD', 'BT'] as const;

export const EVENT_TRIGGERS = [
  'message',
  'timer',
  'error',
  'escalation',
  'cancel',
  'compensation',
  'conditional',
  'link',
  'signal',
  'terminate',
  'parallel-multiple',
  'multiple',
  'none',
] as const;

export const TASK_TYPES = [
  'user',
  'service',
  'receive',
  'send',
  'manual',
  'script',
  'rule',
] as const;

export const TRIGGERS_BY_POSITION = {
  start: [
    'none',
    'message',
    'timer',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
    'error',
    'escalation',
    'compensation',
  ],
  intermediate: [
    'message',
    'timer',
    'conditional',
    'link',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  throw: ['none', 'message', 'escalation', 'compensation', 'link', 'signal', 'multiple'],
  boundary: [
    'message',
    'timer',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'conditional',
    'signal',
    'multiple',
    'parallel-multiple',
  ],
  end: [
    'none',
    'message',
    'error',
    'escalation',
    'cancel',
    'compensation',
    'signal',
    'terminate',
    'multiple',
  ],
} as const satisfies Record<string, readonly EventTrigger[]>;

export const positionsFor = (trigger: string): string[] =>
  Object.entries(TRIGGERS_BY_POSITION)
    .filter(([, triggers]) => (triggers as readonly string[]).includes(trigger))
    .map(([position]) => position);

// Keyword tolerance: every canonical element keyword (the form the docs show, and the only
// form the parser emits) maps to the synonyms it also accepts. Matching is case-insensitive.
// Synonyms are resolved by POSITION in the visitor — the first word of a declaration — so a
// synonym typed anywhere else (an id, a flow endpoint, a label) stays an ordinary word.
export const KEYWORD_SYNONYMS: Record<string, readonly string[]> = {
  // containers
  pool: ['participant'],
  lane: ['swimlane'],
  group: [],
  // event positions
  start: ['begin'],
  intermediate: [],
  boundary: [],
  end: ['stop'],
  throw: [],
  // gateways
  xor: ['exclusive', 'decision'],
  and: ['parallel'],
  or: ['inclusive'],
  'event-gateway': ['event-based', 'eventgateway'],
  complex: [],
  // activities
  task: ['activity', 'step'],
  subprocess: [],
  call: [],
  // artifacts
  'data-store': ['datastore'],
  'data-collection': [],
  'data-input': [],
  'data-output': [],
  data: [],
  note: ['annotation'],
} as const;

export type BpmnDirection = (typeof BPMN_DIRECTIONS)[number];
export type EventTrigger = (typeof EVENT_TRIGGERS)[number];
export type TaskType = (typeof TASK_TYPES)[number];
