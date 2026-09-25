---
'mermaid': minor
---

feat(bpmn): opt-in semantic validation with fix-suggesting errors

Add an opt-in `bpmn.strict` config flag (default `false`) that checks a `bpmn-beta` diagram against a catalogue of semantic rules. When it is enabled — globally through `mermaid.initialize` or per diagram in the frontmatter — `mermaid.parse` fails an offending diagram with one error listing every violation, each naming the offending id or line, the rule, and a copy-and-paste fix (including a Levenshtein "did you mean" for a mistyped id). By default nothing changes: a diagram renders exactly as it does today.

Rules: reachability, checked per connected component so two independent fragments in one lane never fault each other and a fragment with no explicit start/end is treated as an implicit snippet (a boundary event seeds its own exception path); start/end flow direction; message flows across pools and sequence flows within one; and unknown/duplicate ids. Flow labels are treated as presentation only — since the grammar cannot tell a name from a condition, a label on any flow, including a branch out of a parallel gateway, is never a violation. A regression test runs every shipped bpmn-beta example through the catalogue and asserts zero violations.
