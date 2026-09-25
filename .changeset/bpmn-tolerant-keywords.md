---
'mermaid': minor
---

feat(bpmn): case-insensitive keywords and synonym tolerance

The `bpmn-beta` parser now resolves element keywords by position: the first word of a declaration is matched case-insensitively and accepts a small set of common synonyms, so near-miss input — the kind an LLM or a hurried human produces — still parses to the exact same model. Because the resolution is contextual, it never reserves a word anywhere else: any word (including a keyword, a synonym or a direction like `lr`) is still usable as a node id, a flow endpoint or a label. Canonical documents are unchanged — the forms the docs show remain the ones the parser emits.

Accepted synonyms in the keyword position: `participant` (pool), `swimlane` (lane), `begin` (start), `stop` (end), `activity`/`step` (task), `exclusive`/`decision` (xor), `parallel` (and), `inclusive` (or), `event-based`/`eventgateway` (event-gateway), `datastore` (data-store), `annotation` (note); plus `→` for a sequence flow and `=>`/`==>` for a message flow. Directions accept `LR`, `RL`, `TB`, `TD` and `BT` in any case. The shared `title`, `accTitle` and `accDescr` directives keep Mermaid's standard casing.
