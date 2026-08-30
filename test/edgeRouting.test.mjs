import test from "node:test";
import assert from "node:assert/strict";
import { edgeGeometry, edgeWithManualWaypoint } from "../src/edgeRouting.ts";

test("edge router keeps aligned nodes as a straight segment", () => {
  const source = agentNode("source", 0, 0);
  const target = agentNode("target", 300, 0);
  const geometry = edgeGeometry({}, source, target);

  assert.equal(segmentCount(geometry.points), 1);
});

test("edge router prefers one bend for simple non-straight paths", () => {
  const source = agentNode("source", 0, 0);
  const target = agentNode("target", 300, 160);
  const geometry = edgeGeometry({}, source, target);

  assert.equal(segmentCount(geometry.points), 2);
});

test("manual orthogonal waypoint is preserved", () => {
  const source = agentNode("source", 0, 0);
  const target = agentNode("target", 300, 160);
  const waypoint = { x: 240, y: 210 };
  const geometry = edgeGeometry({ routingMode: "manual", waypoints: [waypoint] }, source, target);

  assert.ok(geometry.points.some((point) => samePoint(point, waypoint)));
  assert.ok(geometry.points.every((point, index, points) => index === 0 || axisAligned(point, points[index - 1])));
});

test("manual waypoint drag keeps a legacy bend fallback for persisted save responses", () => {
  const edge = edgeWithManualWaypoint({ routingMode: "auto", waypoints: [], bend: null }, { x: 240.4, y: 210.6 });

  assert.equal(edge.routingMode, "manual");
  assert.deepEqual(edge.waypoints, [{ x: 240, y: 211 }]);
  assert.deepEqual(edge.bend, { x: 240, y: 211 });
});

function agentNode(id, x, y) {
  return { id, type: "agent", x, y, agentId: null };
}

function segmentCount(points) {
  return Math.max(0, points.length - 1);
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) <= 0.01 && Math.abs(left.y - right.y) <= 0.01;
}

function axisAligned(left, right) {
  return Math.abs(left.x - right.x) <= 0.01 || Math.abs(left.y - right.y) <= 0.01;
}
