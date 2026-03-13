import type {
  CircuitItem,
  EditorState,
  ExportIssue,
  GateItem,
  HorizontalSegmentItem,
  SwapXItem,
  VerticalConnectorItem
} from "./types";
import { getGateLabelIssues, getLabelIssues } from "./tex";

function issue(id: string, message: string, severity: "error" | "warning" = "error"): ExportIssue {
  return { id, message, severity };
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function connectorRange(item: VerticalConnectorItem): [number, number] {
  return [item.point.row, item.point.row + item.length];
}

function swapEndpointCount(item: SwapXItem, connectors: VerticalConnectorItem[]): number {
  return connectors.filter((connector) => {
    if (connector.point.col !== item.point.col) {
      return false;
    }

    const [start, end] = connectorRange(connector);
    return item.point.row === start || item.point.row === end;
  }).length;
}

export function validateCircuit(state: EditorState): ExportIssue[] {
  const issues: ExportIssue[] = [];
  const anchors = new Map<string, CircuitItem[]>();
  const gates = state.items.filter((item): item is GateItem => item.type === "gate");
  const connectors = state.items.filter(
    (item): item is VerticalConnectorItem => item.type === "verticalConnector"
  );
  const horizontals = state.items.filter(
    (item): item is HorizontalSegmentItem => item.type === "horizontalSegment"
  );
  const swaps = state.items.filter((item): item is SwapXItem => item.type === "swapX");

  for (const item of state.items) {
    if (item.type === "horizontalSegment") {
      if (item.point.row < 0 || item.point.row >= state.qubits) {
        issues.push(issue(item.id, "Horizontal segment is outside the qubit range."));
      }
      if (item.point.col < 0 || item.point.col > state.steps) {
        issues.push(issue(item.id, "Horizontal segment is outside the step range."));
      }
      continue;
    }

    if (item.point.row < 0 || item.point.row >= state.qubits) {
      issues.push(issue(item.id, `${item.type} is outside the qubit range.`));
    }

    if (item.point.col < 0 || item.point.col >= state.steps) {
      issues.push(issue(item.id, `${item.type} is outside the step range.`));
    }

    if (item.type === "verticalConnector") {
      if (item.length < 1) {
        issues.push(issue(item.id, "Vertical connector must span at least one row."));
      }
      if (item.point.row + item.length >= state.qubits) {
        issues.push(issue(item.id, "Vertical connector extends beyond the grid."));
      }
    }

    if (item.type === "gate") {
      if (item.span.rows < 1) {
        issues.push(issue(item.id, "Gate span must cover at least one qubit."));
      }
      if (item.point.row + item.span.rows > state.qubits) {
        issues.push(issue(item.id, "Gate span extends beyond the grid."));
      }

      for (const [labelIssueIndex, labelIssue] of getGateLabelIssues(item.label).entries()) {
        issues.push(issue(`${item.id}-label-${labelIssueIndex}`, labelIssue.message, labelIssue.severity));
      }
    }

    const key = cellKey(item.point.row, item.point.col);
    const bucket = anchors.get(key) ?? [];
    bucket.push(item);
    anchors.set(key, bucket);
  }

  for (const [key, items] of anchors.entries()) {
    const gateCount = items.filter((item) => item.type === "gate").length;
    const controlCount = items.filter((item) => item.type === "controlDot").length;
    const targetCount = items.filter((item) => item.type === "targetPlus").length;
    const swapCount = items.filter((item) => item.type === "swapX").length;

    if (gateCount > 1) {
      issues.push(issue(`gate-overlap-${key}`, "Only one gate can anchor in a cell."));
    }

    if (gateCount === 1 && (controlCount > 0 || targetCount > 0 || swapCount > 0)) {
      issues.push(issue(`mixed-anchor-${key}`, "Gates cannot share a cell with dots, targets, or swaps."));
    }

    if (controlCount > 1 || targetCount > 1 || swapCount > 1) {
      issues.push(issue(`duplicate-anchor-${key}`, "Only one marker of each type is allowed in a cell."));
    }

    if (controlCount > 0 && targetCount > 0) {
      issues.push(issue(`control-target-${key}`, "A control dot and a target cannot occupy the same cell."));
    }
  }

  for (const gate of gates) {
    for (const other of gates) {
      if (gate.id === other.id || gate.point.col !== other.point.col) {
        continue;
      }

      const gateStart = gate.point.row;
      const gateEnd = gate.point.row + gate.span.rows - 1;
      const otherStart = other.point.row;
      const otherEnd = other.point.row + other.span.rows - 1;

      const overlaps = !(gateEnd < otherStart || otherEnd < gateStart);
      if (overlaps) {
        issues.push(issue(`gate-span-${gate.id}-${other.id}`, "Multi-qubit gate spans overlap."));
      }
    }
  }

  const connectorsByColumn = new Map<number, VerticalConnectorItem[]>();
  for (const connector of connectors) {
    const bucket = connectorsByColumn.get(connector.point.col) ?? [];
    bucket.push(connector);
    connectorsByColumn.set(connector.point.col, bucket);
  }

  for (const columnConnectors of connectorsByColumn.values()) {
    columnConnectors.sort((left, right) => left.point.row - right.point.row);

    for (let index = 1; index < columnConnectors.length; index += 1) {
      const prev = columnConnectors[index - 1];
      const next = columnConnectors[index];
      const [, prevEnd] = connectorRange(prev);
      const [nextStart] = connectorRange(next);
      if (nextStart <= prevEnd) {
        issues.push(issue(`connector-overlap-${prev.id}-${next.id}`, "Overlapping vertical connectors in one column are not supported."));
      }
    }
  }

  for (const swap of swaps) {
    const endpointCount = swapEndpointCount(swap, connectors);
    if (endpointCount !== 1) {
      issues.push(issue(`swap-endpoint-${swap.id}`, "Each swap X must be an endpoint of exactly one vertical connector."));
    }
  }

  for (const connector of connectors) {
    const [start, end] = connectorRange(connector);
    const swapEndpoints = swaps.filter((swap) => swap.point.col === connector.point.col)
      .filter((swap) => swap.point.row === start || swap.point.row === end);

    if (swapEndpoints.length === 1) {
      issues.push(issue(`swap-pair-${connector.id}`, "A swap connector must terminate in two swap X markers."));
    }
  }

  for (const horizontal of horizontals) {
    const maskKey = `${horizontal.point.row}:${horizontal.point.col}`;
    const existingValue = state.wireMask[maskKey];
    if (existingValue && existingValue !== horizontal.mode) {
      issues.push(issue(`wiremask-${horizontal.id}`, "Horizontal wire overrides disagree at the same segment.", "warning"));
    }
  }

  for (const [rowIndex, labels] of state.wireLabels.entries()) {
    for (const [issueIndex, labelIssue] of getLabelIssues(labels.left, "Left wire label", {
      allowEmpty: true
    }).entries()) {
      issues.push(issue(`wire-left-${rowIndex}-${issueIndex}`, labelIssue.message, labelIssue.severity));
    }

    for (const [issueIndex, labelIssue] of getLabelIssues(labels.right, "Right wire label", {
      allowEmpty: true
    }).entries()) {
      issues.push(issue(`wire-right-${rowIndex}-${issueIndex}`, labelIssue.message, labelIssue.severity));
    }
  }

  return issues;
}
