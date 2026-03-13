import type {
  CircuitItem,
  EditorState,
  ExportIssue,
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

function connectorRange(item: Pick<VerticalConnectorItem, "point" | "length">): [number, number] {
  return [item.point.row, item.point.row + item.length];
}

interface NormalizedConnectorGroup {
  point: { row: number; col: number };
  length: number;
  wireType: VerticalConnectorItem["wireType"];
  color: string | null;
  members: VerticalConnectorItem[];
}

function normalizeConnectors(connectors: VerticalConnectorItem[]): NormalizedConnectorGroup[] {
  const byColumn = new Map<number, VerticalConnectorItem[]>();

  for (const connector of connectors) {
    const bucket = byColumn.get(connector.point.col) ?? [];
    bucket.push(connector);
    byColumn.set(connector.point.col, bucket);
  }

  const normalized: NormalizedConnectorGroup[] = [];

  for (const [col, columnConnectors] of byColumn.entries()) {
    const sorted = [...columnConnectors].sort((left, right) =>
      left.point.row - right.point.row || left.length - right.length
    );

    let active: NormalizedConnectorGroup | null = null;

    for (const connector of sorted) {
      const [start, end] = connectorRange(connector);

      if (!active) {
        active = {
          point: { row: start, col },
          length: end - start,
          wireType: connector.wireType,
          color: connector.color ?? null,
          members: [connector]
        };
        continue;
      }

      const activeEnd = active.point.row + active.length;
      if (start <= activeEnd) {
        active = {
          point: active.point,
          length: Math.max(activeEnd, end) - active.point.row,
          wireType: active.wireType === "classical" || connector.wireType === "classical"
            ? "classical"
            : "quantum",
          color: active.color ?? connector.color ?? null,
          members: [...active.members, connector]
        };
        continue;
      }

      normalized.push(active);
      active = {
        point: { row: start, col },
        length: end - start,
        wireType: connector.wireType,
        color: connector.color ?? null,
        members: [connector]
      };
    }

    if (active) {
      normalized.push(active);
    }
  }

  return normalized;
}

function swapEndpointCount(item: SwapXItem, connectors: Array<Pick<VerticalConnectorItem, "point" | "length">>): number {
  return connectors.filter((connector) => {
    if (connector.point.col !== item.point.col) {
      return false;
    }

    const [start, end] = connectorRange(connector);
    return item.point.row === start || item.point.row === end;
  }).length;
}

function gateLikeSpanRows(item: CircuitItem): number {
  return item.type === "gate" || item.type === "meter" ? item.span.rows : 1;
}

function gateLikeSpanCols(item: CircuitItem): number {
  return item.type === "gate" ? item.span.cols : 1;
}

export function validateCircuit(state: EditorState): ExportIssue[] {
  const issues: ExportIssue[] = [];
  const anchors = new Map<string, CircuitItem[]>();
  const gateLikes = state.items.filter((item) => item.type === "gate" || item.type === "meter");
  const connectors = state.items.filter(
    (item): item is VerticalConnectorItem => item.type === "verticalConnector"
  );
  const normalizedConnectors = normalizeConnectors(connectors);
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
      if (item.span.cols < 1) {
        issues.push(issue(item.id, "Gate span must cover at least one step."));
      }
      if (item.point.col + item.span.cols > state.steps) {
        issues.push(issue(item.id, "Gate width extends beyond the grid."));
      }

      for (const [labelIssueIndex, labelIssue] of getGateLabelIssues(item.label).entries()) {
        issues.push(issue(`${item.id}-label-${labelIssueIndex}`, labelIssue.message, labelIssue.severity));
      }
    }

    if (item.type === "meter") {
      if (item.span.rows < 1) {
        issues.push(issue(item.id, "Measurement span must cover at least one qubit."));
      }
      if (item.point.row + item.span.rows > state.qubits) {
        issues.push(issue(item.id, "Measurement span extends beyond the grid."));
      }
    }

    if (item.type === "frame") {
      if (item.span.rows < 1 || item.span.cols < 1) {
        issues.push(issue(item.id, "Frame must span at least one row and one step."));
      }
      if (item.point.row + item.span.rows > state.qubits || item.point.col + item.span.cols > state.steps) {
        issues.push(issue(item.id, "Frame extends beyond the grid."));
      }

      for (const [labelIssueIndex, labelIssue] of getLabelIssues(item.label, "Frame label", { allowEmpty: true }).entries()) {
        issues.push(issue(`${item.id}-label-${labelIssueIndex}`, labelIssue.message, labelIssue.severity));
      }
    }

    if (item.type === "slice") {
      for (const [labelIssueIndex, labelIssue] of getLabelIssues(item.label, "Slice label", { allowEmpty: true }).entries()) {
        issues.push(issue(`${item.id}-label-${labelIssueIndex}`, labelIssue.message, labelIssue.severity));
      }
    }

    const key = cellKey(item.point.row, item.point.col);
    const bucket = anchors.get(key) ?? [];
    bucket.push(item);
    anchors.set(key, bucket);
  }

  for (const [key, items] of anchors.entries()) {
    const anchoredItems = items.filter((item) => item.type !== "frame" && item.type !== "slice");
    const gateCount = anchoredItems.filter((item) => item.type === "gate" || item.type === "meter").length;
    const controlCount = anchoredItems.filter((item) => item.type === "controlDot").length;
    const targetCount = anchoredItems.filter((item) => item.type === "targetPlus").length;
    const swapCount = anchoredItems.filter((item) => item.type === "swapX").length;

    if (gateCount > 1) {
      issues.push(issue(`gate-overlap-${key}`, "Only one gate-like object can anchor in a cell."));
    }

    if (gateCount === 1 && (controlCount > 0 || targetCount > 0 || swapCount > 0)) {
      issues.push(issue(`mixed-anchor-${key}`, "Gate-like objects cannot share a cell with dots, targets, or swaps."));
    }

    if (controlCount > 1 || targetCount > 1 || swapCount > 1) {
      issues.push(issue(`duplicate-anchor-${key}`, "Only one marker of each type is allowed in a cell."));
    }

    if (controlCount > 0 && targetCount > 0) {
      issues.push(issue(`control-target-${key}`, "A control dot and a target cannot occupy the same cell."));
    }
  }

  for (let gateIndex = 0; gateIndex < gateLikes.length; gateIndex += 1) {
    const gateLike = gateLikes[gateIndex];
    const gateTop = gateLike.point.row;
    const gateBottom = gateLike.point.row + gateLikeSpanRows(gateLike) - 1;
    const gateLeft = gateLike.point.col;
    const gateRight = gateLike.point.col + gateLikeSpanCols(gateLike) - 1;

    for (let otherIndex = gateIndex + 1; otherIndex < gateLikes.length; otherIndex += 1) {
      const other = gateLikes[otherIndex];
      const otherTop = other.point.row;
      const otherBottom = other.point.row + gateLikeSpanRows(other) - 1;
      const otherLeft = other.point.col;
      const otherRight = other.point.col + gateLikeSpanCols(other) - 1;

      const overlaps = !(
        gateRight < otherLeft ||
        otherRight < gateLeft ||
        gateBottom < otherTop ||
        otherBottom < gateTop
      );
      if (overlaps) {
        issues.push(issue(`gate-span-${gateLike.id}-${other.id}`, "Gate-like spans overlap in the circuit area."));
      }
    }

    for (const other of state.items) {
      if (
        other.id === gateLike.id ||
        other.type === "frame" ||
        other.type === "slice" ||
        other.type === "horizontalSegment" ||
        other.type === "verticalConnector"
      ) {
        continue;
      }

      const insideSpan =
        other.point.row >= gateTop &&
        other.point.row <= gateBottom &&
        other.point.col >= gateLeft &&
        other.point.col <= gateRight;

      if (insideSpan && !(other.point.row === gateLike.point.row && other.point.col === gateLike.point.col)) {
        issues.push(issue(`gate-occupied-${gateLike.id}-${other.id}`, "A gate-like span overlaps another anchored object."));
      }
    }
  }

  for (const swap of swaps) {
    const endpointCount = swapEndpointCount(swap, normalizedConnectors);
    if (endpointCount !== 1) {
      issues.push(issue(`swap-endpoint-${swap.id}`, "Each swap X must be an endpoint of exactly one vertical connector."));
    }
  }

  for (const connector of normalizedConnectors) {
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
