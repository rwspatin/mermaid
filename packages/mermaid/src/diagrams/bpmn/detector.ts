import type {
  DiagramDetector,
  DiagramLoader,
  ExternalDiagramDefinition,
} from '../../diagram-api/types.js';

const id = 'bpmn';

const detector: DiagramDetector = (txt) => /^\s*bpmn-beta\b/i.test(txt);

const loader: DiagramLoader = async () => {
  const { diagram } = await import('./diagram.js');
  return { id, diagram };
};

export const bpmn: ExternalDiagramDefinition = { id, detector, loader };
