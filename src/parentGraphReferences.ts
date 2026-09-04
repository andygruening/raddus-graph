import type { GraphDocument, GraphEdge, GraphNode, GraphState, ProjectRecord } from "./api/RaddusGraphApi";

type Point = { x: number; y: number };

export type ParentGraphReference = {
  id: string;
  parentProject: ProjectRecord;
  parentGraphNodeId: string;
  node: GraphNode;
  targetPlayNode: GraphNode;
  edge: GraphEdge;
};

export function parentGraphReferencesForState(state: GraphState, selectedProject: ProjectRecord): ParentGraphReference[] {
  const targetPlayNode = state.graph.nodes.find((node) => node.type === "play");
  if (!targetPlayNode) return [];

  const occupiedRects = state.graph.nodes.map((node) => projectNodeRect(node));
  const references: ParentGraphReference[] = [];

  for (const parentProject of state.projects) {
    if (parentProject.id === selectedProject.id) continue;
    const parentGraphNode = firstExecutableGraphNodeForProject(parentProject.graph, selectedProject.id);
    if (!parentGraphNode) continue;

    const referenceId = parentGraphReferenceKey(parentProject.id, parentGraphNode.id);
    const storedPosition = state.graph.parentGraphReferencePositions?.[referenceId];
    const position = storedPosition ?? parentGraphReferencePosition(targetPlayNode, occupiedRects, references.length);
    const node: GraphNode = {
      id: parentGraphReferenceNodeId(parentProject.id, parentGraphNode.id),
      type: "graph",
      graphId: parentProject.id,
      x: position.x,
      y: position.y,
    };
    const edge: GraphEdge = {
      id: parentGraphReferenceEdgeId(parentProject.id, parentGraphNode.id, targetPlayNode.id),
      source: node.id,
      target: targetPlayNode.id,
      type: "runs",
      routingMode: "auto",
    };

    references.push({
      id: referenceId,
      parentProject,
      parentGraphNodeId: parentGraphNode.id,
      node,
      targetPlayNode,
      edge,
    });
    occupiedRects.push(projectNodeRect(node));
  }

  return references;
}

export function graphWithParentGraphReferencePosition(graph: GraphDocument, referenceId: string, position: Point): GraphDocument {
  return {
    ...graph,
    parentGraphReferencePositions: {
      ...(graph.parentGraphReferencePositions ?? {}),
      [referenceId]: position,
    },
  };
}

function firstExecutableGraphNodeForProject(graph: GraphDocument, childProjectId: string): GraphNode | null {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.nodes.find((node) => (
    node.type === "graph" &&
    node.graphId === childProjectId &&
    graph.edges.some((edge) => isExecutableIncomingGraphEdge(edge, graph.edges, nodesById, node.id))
  )) ?? null;
}

function isExecutableIncomingGraphEdge(
  edge: GraphEdge,
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  graphNodeId: string,
): boolean {
  if (edge.target !== graphNodeId) return false;
  const source = nodesById.get(edge.source);
  if (edge.type === "runs") return source?.type === "play";
  return edge.type === "routes" &&
    source?.type === "expression" &&
    hasEvaluatingSource(edge.source, edges, nodesById);
}

function hasEvaluatingSource(expressionNodeId: string, edges: GraphEdge[], nodesById: Map<string, GraphNode>): boolean {
  return edges.some((edge) => {
    if (edge.target !== expressionNodeId || edge.type !== "evaluates") return false;
    const source = nodesById.get(edge.source);
    return source?.type === "agent" || source?.type === "graph" || source?.type === "any";
  });
}

function parentGraphReferencePosition(
  targetPlayNode: GraphNode,
  occupiedRects: Array<{ x: number; y: number; width: number; height: number }>,
  index: number,
): Point {
  const size = projectNodeSizeForType("graph");
  const playSize = projectNodeSizeForType("play");
  const horizontalGap = 92;
  const slotStep = size.height + 24;
  const x = Math.round(targetPlayNode.x + playSize.width + horizontalGap);
  const preferredY = Math.round(projectNodeCenter(targetPlayNode).y - size.height / 2);
  const slotOffsets = [0];
  for (let slot = 1; slot <= 18; slot += 1) {
    slotOffsets.push(slot, -slot);
  }

  for (const slotOffset of slotOffsets) {
    const candidate = { x, y: preferredY + slotOffset * slotStep, width: size.width, height: size.height };
    if (!occupiedRects.some((rect) => canvasRectsOverlap(candidate, rect, 22))) return { x: candidate.x, y: candidate.y };
  }

  return { x, y: preferredY + (slotOffsets.length + index) * slotStep };
}

function parentGraphReferenceNodeId(parentProjectId: string, parentGraphNodeId: string): string {
  return `parent-graph-reference-${parentProjectId}-${parentGraphNodeId}`;
}

function parentGraphReferenceEdgeId(parentProjectId: string, parentGraphNodeId: string, targetPlayNodeId: string): string {
  return `parent-graph-reference-edge-${parentProjectId}-${parentGraphNodeId}-${targetPlayNodeId}`;
}

function parentGraphReferenceKey(parentProjectId: string, parentGraphNodeId: string): string {
  return `${parentProjectId}:${parentGraphNodeId}`;
}

function projectNodeCenter(node: GraphNode): Point {
  const size = projectNodeSizeForType(node.type);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function projectNodeSizeForType(type: GraphNode["type"]): { width: number; height: number } {
  if (type === "expression") return { width: 140, height: 44 };
  if (type === "play" || type === "any") return { width: 56, height: 56 };
  if (type === "agent" || type === "graph") return { width: 168, height: 72 };
  return { width: 168, height: 72 };
}

function projectNodeRect(node: GraphNode): { x: number; y: number; width: number; height: number } {
  return { x: node.x, y: node.y, ...projectNodeSizeForType(node.type) };
}

function canvasRectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  padding = 0,
): boolean {
  return !(
    left.x + left.width + padding < right.x ||
    right.x + right.width + padding < left.x ||
    left.y + left.height + padding < right.y ||
    right.y + right.height + padding < left.y
  );
}
