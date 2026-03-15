import type {
  CircuitItem,
  ControlDotItem,
  SwapXItem,
  VerticalConnectorItem,
  WireType
} from "./types";

export interface NormalizedConnectorGroup {
  point: { row: number; col: number };
  length: number;
  wireType: WireType;
  color: string | null;
  members: VerticalConnectorItem[];
}

export interface SwapStatus {
  valid: boolean;
  message: string | null;
  connector: NormalizedConnectorGroup | null;
  swaps: SwapXItem[];
  controls: ControlDotItem[];
}

export function connectorRange(item: Pick<VerticalConnectorItem, "point" | "length">): [number, number] {
  return [item.point.row, item.point.row + item.length];
}

export function connectorContainsRow(
  item: Pick<VerticalConnectorItem, "point" | "length">,
  row: number
): boolean {
  const [start, end] = connectorRange(item);
  return row >= start && row <= end;
}

export function normalizeConnectors(connectors: VerticalConnectorItem[]): NormalizedConnectorGroup[] {
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

export function pickControlledSwapAnchorRow(controlRow: number, topSwapRow: number, bottomSwapRow: number): number {
  if (controlRow <= topSwapRow) {
    return topSwapRow;
  }

  if (controlRow >= bottomSwapRow) {
    return bottomSwapRow;
  }

  return controlRow - topSwapRow <= bottomSwapRow - controlRow ? topSwapRow : bottomSwapRow;
}

export function getSwapStatusById(items: CircuitItem[]): Map<string, SwapStatus> {
  const connectors = normalizeConnectors(
    items.filter((item): item is VerticalConnectorItem => item.type === "verticalConnector")
  );
  const controls = items.filter((item): item is ControlDotItem => item.type === "controlDot");
  const swaps = items.filter((item): item is SwapXItem => item.type === "swapX");
  const statusById = new Map<string, SwapStatus>();

  for (const connector of connectors) {
    const connectorSwaps = swaps.filter((swap) =>
      swap.point.col === connector.point.col && connectorContainsRow(connector, swap.point.row)
    );

    if (connectorSwaps.length === 0) {
      continue;
    }

    const connectorControls = controls.filter((control) =>
      control.point.col === connector.point.col && connectorContainsRow(connector, control.point.row)
    );

    const message =
      connectorSwaps.length === 2
        ? null
        : connectorSwaps.length === 1
          ? "Connect this swap X to one other swap X on the same vertical wire."
          : "Only one swap pair can share the same connected vertical wire.";

    for (const swap of connectorSwaps) {
      statusById.set(swap.id, {
        valid: message === null,
        message,
        connector,
        swaps: connectorSwaps,
        controls: connectorControls
      });
    }
  }

  for (const swap of swaps) {
    if (statusById.has(swap.id)) {
      continue;
    }

    statusById.set(swap.id, {
      valid: false,
      message: "Connect this swap X to one other swap X with a vertical wire.",
      connector: null,
      swaps: [swap],
      controls: []
    });
  }

  return statusById;
}
