import type { CardAnchor, GraphEdge, GraphNode, GraphNodeType } from "./api/RaddusGraphApi";

export type Point = { x: number; y: number };

export type EdgeGeometry = {
  path: string;
  points: Point[];
  length: number;
  handle: Point;
  label: Point;
  arrow: Point & { angle: number };
  sourcePoint: Point;
  targetPoint: Point;
  sourceAnchor: CardAnchor;
  targetAnchor: CardAnchor;
};

type EdgeRoutingInput = Pick<GraphEdge, "bend" | "routingMode" | "sourceAnchor" | "targetAnchor" | "waypoints">;

type EdgeRoute = {
  points: Point[];
  controls: Point[];
  sourcePoint: Point;
  targetPoint: Point;
  sourceAnchor: CardAnchor;
  targetAnchor: CardAnchor;
};

const allAnchors: CardAnchor[] = ["right", "bottom", "left", "top"];
const epsilon = 0.01;

export function edgeGeometry(edge: EdgeRoutingInput, source: GraphNode, target: GraphNode): EdgeGeometry {
  const route = bestEdgeRoute(edge, source, target);
  const arrow = pointOnPolyline(route.points, 0.5);
  return {
    path: edgePathFromPoints(route.points),
    points: route.points,
    length: polylineLength(route.points),
    handle: route.controls[0] ?? routeHandle(route.points),
    label: arrow,
    arrow,
    sourcePoint: route.sourcePoint,
    targetPoint: route.targetPoint,
    sourceAnchor: route.sourceAnchor,
    targetAnchor: route.targetAnchor,
  };
}

export function edgePath(source: GraphNode, target: GraphNode, bend?: Point | null): string {
  return edgeGeometry(bend ? { routingMode: "manual", waypoints: [bend] } : {}, source, target).path;
}

export function defaultBendForNodes(source: GraphNode, target: GraphNode): Point {
  return routeHandle(bestEdgeRoute({}, source, target).points);
}

export function edgeWithManualWaypoint<T extends Pick<GraphEdge, "bend" | "routingMode" | "waypoints">>(edge: T, waypoint: Point): T {
  const point = { x: Math.round(waypoint.x), y: Math.round(waypoint.y) };
  return {
    ...edge,
    routingMode: "manual",
    waypoints: [point],
    bend: point,
  };
}

export function connectionPreviewPath(source: GraphNode, target: Point): string {
  const sourceAnchor = cardAnchorForPoint(source, target);
  const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
  return edgePathFromPoints(previewRoutePoints(sourcePoint, target, sourceAnchor));
}

function bestEdgeRoute(edge: EdgeRoutingInput, source: GraphNode, target: GraphNode): EdgeRoute {
  const controls = edgeControls(edge);
  const firstControl = controls[0] ?? null;
  const lastControl = controls.at(-1) ?? null;
  const sourceAnchors = edge.sourceAnchor ? [edge.sourceAnchor] : allAnchors;
  const targetAnchors = edge.targetAnchor ? [edge.targetAnchor] : allAnchors;
  const preferredSourceAnchor = cardAnchorForPoint(source, firstControl ?? projectNodeCenter(target));
  const preferredTargetAnchor = cardAnchorForPoint(target, lastControl ?? projectNodeCenter(source));
  let best: (EdgeRoute & { cost: number }) | null = null;

  for (const sourceAnchor of sourceAnchors) {
    for (const targetAnchor of targetAnchors) {
      const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
      const targetPoint = projectNodeAnchorPoint(target, targetAnchor);
      const points = controls.length > 0
        ? manualRoutePoints(sourcePoint, targetPoint, controls, sourceAnchor, targetAnchor)
        : automaticRoutePoints(sourcePoint, targetPoint, sourceAnchor, targetAnchor);
      const cost = routeCost({
        points,
        sourceAnchor,
        targetAnchor,
        preferredSourceAnchor,
        preferredTargetAnchor,
      });
      if (!best || cost < best.cost) {
        best = { points, controls, sourcePoint, targetPoint, sourceAnchor, targetAnchor, cost };
      }
    }
  }

  if (best) return best;
  const sourceAnchor = edge.sourceAnchor ?? cardAnchorForPoint(source, projectNodeCenter(target));
  const targetAnchor = edge.targetAnchor ?? cardAnchorForPoint(target, projectNodeCenter(source));
  const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
  const targetPoint = projectNodeAnchorPoint(target, targetAnchor);
  return { points: compactEdgePoints([sourcePoint, targetPoint]), controls, sourcePoint, targetPoint, sourceAnchor, targetAnchor };
}

function automaticRoutePoints(sourcePoint: Point, targetPoint: Point, sourceAnchor: CardAnchor, targetAnchor: CardAnchor): Point[] {
  return routeLegPoints(sourcePoint, targetPoint, sourceAnchor, targetAnchor);
}

function manualRoutePoints(sourcePoint: Point, targetPoint: Point, controls: Point[], sourceAnchor: CardAnchor, targetAnchor: CardAnchor): Point[] {
  const points = [sourcePoint];
  const routeTargets = [...controls, targetPoint];

  routeTargets.forEach((routeTarget, index) => {
    const isFirstLeg = index === 0;
    const isFinalLeg = index === routeTargets.length - 1;
    const segment = routeLegPoints(
      points.at(-1) ?? sourcePoint,
      routeTarget,
      isFirstLeg ? sourceAnchor : null,
      isFinalLeg ? targetAnchor : null,
    );
    points.push(...segment.slice(1));
  });

  return compactEdgePoints(points);
}

function routeLegPoints(sourcePoint: Point, targetPoint: Point, sourceAnchor: CardAnchor | null, targetAnchor: CardAnchor | null): Point[] {
  if (axisAligned(sourcePoint, targetPoint)) return compactEdgePoints([sourcePoint, targetPoint]);

  const candidates = [
    compactEdgePoints([sourcePoint, { x: targetPoint.x, y: sourcePoint.y }, targetPoint]),
    compactEdgePoints([sourcePoint, { x: sourcePoint.x, y: targetPoint.y }, targetPoint]),
    compactEdgePoints([sourcePoint, { x: (sourcePoint.x + targetPoint.x) / 2, y: sourcePoint.y }, { x: (sourcePoint.x + targetPoint.x) / 2, y: targetPoint.y }, targetPoint]),
    compactEdgePoints([sourcePoint, { x: sourcePoint.x, y: (sourcePoint.y + targetPoint.y) / 2 }, { x: targetPoint.x, y: (sourcePoint.y + targetPoint.y) / 2 }, targetPoint]),
  ];
  return candidates.sort((left, right) =>
    routePointCost(left, sourceAnchor, targetAnchor) - routePointCost(right, sourceAnchor, targetAnchor)
  )[0];
}

function previewRoutePoints(sourcePoint: Point, targetPoint: Point, sourceAnchor: CardAnchor): Point[] {
  if (axisAligned(sourcePoint, targetPoint)) return compactEdgePoints([sourcePoint, targetPoint]);
  const candidates = [
    compactEdgePoints([sourcePoint, { x: targetPoint.x, y: sourcePoint.y }, targetPoint]),
    compactEdgePoints([sourcePoint, { x: sourcePoint.x, y: targetPoint.y }, targetPoint]),
  ];
  return candidates.sort((left, right) =>
    sourceDirectionPenalty(left, sourceAnchor) - sourceDirectionPenalty(right, sourceAnchor)
  )[0];
}

function routeCost({
  points,
  sourceAnchor,
  targetAnchor,
  preferredSourceAnchor,
  preferredTargetAnchor,
}: {
  points: Point[];
  sourceAnchor: CardAnchor;
  targetAnchor: CardAnchor;
  preferredSourceAnchor: CardAnchor;
  preferredTargetAnchor: CardAnchor;
}): number {
  const preferredPenalty = (sourceAnchor === preferredSourceAnchor ? 0 : 1) + (targetAnchor === preferredTargetAnchor ? 0 : 1);
  return routePointCost(points, sourceAnchor, targetAnchor) + preferredPenalty * 1_000 + anchorOrderPenalty(sourceAnchor, targetAnchor);
}

function routePointCost(points: Point[], sourceAnchor: CardAnchor | null, targetAnchor: CardAnchor | null): number {
  return endpointDirectionPenalty(points, sourceAnchor, targetAnchor) * 1_000_000 +
    segmentCount(points) * 100_000 +
    polylineLength(points);
}

function endpointDirectionPenalty(points: Point[], sourceAnchor: CardAnchor | null, targetAnchor: CardAnchor | null): number {
  if (points.length < 2) return 0;
  const first = points[1];
  const source = points[0];
  const previous = points[points.length - 2];
  const target = points[points.length - 1];
  return (sourceAnchor ? sourceDirectionPenalty(points, sourceAnchor) : 0) +
    (targetAnchor && !travelsWithAnchor({ x: previous.x - target.x, y: previous.y - target.y }, targetAnchor) ? 1 : 0) +
    (samePoint(source, first) || samePoint(previous, target) ? 1 : 0);
}

function sourceDirectionPenalty(points: Point[], sourceAnchor: CardAnchor): number {
  if (points.length < 2) return 0;
  const source = points[0];
  const first = points[1];
  return travelsWithAnchor({ x: first.x - source.x, y: first.y - source.y }, sourceAnchor) ? 0 : 1;
}

function travelsWithAnchor(vector: Point, anchor: CardAnchor): boolean {
  const direction = anchorDirection(anchor);
  return vector.x * direction.x + vector.y * direction.y > epsilon;
}

function anchorOrderPenalty(sourceAnchor: CardAnchor, targetAnchor: CardAnchor): number {
  return allAnchors.indexOf(sourceAnchor) * 10 + allAnchors.indexOf(targetAnchor);
}

function edgeControls(edge: EdgeRoutingInput): Point[] {
  const waypoints = edge.routingMode === "manual" && Array.isArray(edge.waypoints) ? edge.waypoints.filter(finitePoint) : [];
  if (waypoints.length > 0) return waypoints;
  return finitePoint(edge.bend) ? [edge.bend] : [];
}

function finitePoint(point: Point | null | undefined): point is Point {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function segmentCount(points: Point[]): number {
  return Math.max(0, points.length - 1);
}

function polylineLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function routeHandle(points: Point[]): Point {
  if (points.length === 3) return points[1];
  const point = pointOnPolyline(points, 0.5);
  return { x: point.x, y: point.y };
}

function axisAligned(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= epsilon || Math.abs(left.y - right.y) <= epsilon;
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function projectNodeAnchorPoint(node: GraphNode, anchor: CardAnchor): Point {
  const size = projectNodeSizeForType(node.type);
  if (anchor === "top") return { x: node.x + size.width / 2, y: node.y };
  if (anchor === "right") return { x: node.x + size.width, y: node.y + size.height / 2 };
  if (anchor === "bottom") return { x: node.x + size.width / 2, y: node.y + size.height };
  return { x: node.x, y: node.y + size.height / 2 };
}

export function cardAnchorForPoint(node: GraphNode, point: Point): CardAnchor {
  const center = projectNodeCenter(node);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function anchorDirection(anchor: CardAnchor): Point {
  if (anchor === "top") return { x: 0, y: -1 };
  if (anchor === "right") return { x: 1, y: 0 };
  if (anchor === "bottom") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function compactEdgePoints(points: Point[]): Point[] {
  const deduped = points.reduce<Point[]>((result, point) => {
    const previous = result.at(-1);
    if (!previous || Math.abs(previous.x - point.x) > 0.01 || Math.abs(previous.y - point.y) > 0.01) {
      result.push(point);
    }
    return result;
  }, []);
  if (deduped.length <= 2) return deduped;
  return deduped.filter((point, index, list) => {
    if (index === 0 || index === list.length - 1) return true;
    const previous = list[index - 1];
    const next = list[index + 1];
    const incoming = { x: point.x - previous.x, y: point.y - previous.y };
    const outgoing = { x: next.x - point.x, y: next.y - point.y };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    return Math.abs(cross) > epsilon || dot < -epsilon;
  });
}

function edgePathFromPoints(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" ");
}

function pointOnPolyline(points: Point[], ratio: number): Point & { angle: number } {
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return { previous, point, dx, dy, length: Math.hypot(dx, dy) };
  }).filter((segment) => segment.length > 0.01);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!segments.length || totalLength <= 0) {
    const first = points[0] ?? { x: 0, y: 0 };
    return { x: first.x, y: first.y, angle: 0 };
  }

  const targetLength = totalLength * ratio;
  let traveled = 0;
  for (const segment of segments) {
    if (traveled + segment.length >= targetLength) {
      const progress = (targetLength - traveled) / segment.length;
      return {
        x: segment.previous.x + segment.dx * progress,
        y: segment.previous.y + segment.dy * progress,
        angle: Math.atan2(segment.dy, segment.dx) * 180 / Math.PI,
      };
    }
    traveled += segment.length;
  }

  const last = segments.at(-1);
  return {
    x: last?.point.x ?? 0,
    y: last?.point.y ?? 0,
    angle: last ? Math.atan2(last.dy, last.dx) * 180 / Math.PI : 0,
  };
}

function svgNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function projectNodeCenter(node: GraphNode): Point {
  const size = projectNodeSizeForType(node.type);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

export function projectNodeSizeForType(type: GraphNodeType): { width: number; height: number } {
  if (type === "play" || type === "agent" || type === "expression") return { width: 168, height: 72 };
  return { width: 168, height: 72 };
}
