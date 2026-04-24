#!/usr/bin/env python3
"""Generate slice-by-slice LaTeX evolution for supported Quantikz circuits."""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction

from quantikz_statevector_evolution import (
    ParsedCommand,
    canonical_gate_label,
    decompose_tensor_product_gate_label,
    find_quantikz_environments,
    parse_command_sequence,
    parse_connector,
    parse_label_command,
    parse_product_state_symbols,
    parse_int,
    parse_wires_option,
    split_top_level,
    strip_comments,
)


@dataclass(frozen=True)
class Amplitude:
    real: int = 1
    imag: int = 0
    sqrt2_power: int = 0

    def normalized(self) -> "Amplitude":
        real = self.real
        imag = self.imag
        sqrt2_power = self.sqrt2_power
        if real == 0 and imag == 0:
            return Amplitude(0, 0, 0)
        while sqrt2_power >= 2 and real % 2 == 0 and imag % 2 == 0:
            real //= 2
            imag //= 2
            sqrt2_power -= 2
        return Amplitude(real, imag, sqrt2_power)

    def multiply(self, *, sign: int = 1, sqrt2_power: int = 0, i_power: int = 0) -> "Amplitude":
        real = self.real * sign
        imag = self.imag * sign
        match i_power % 4:
            case 0:
                pass
            case 1:
                real, imag = -imag, real
            case 2:
                real, imag = -real, -imag
            case 3:
                real, imag = imag, -real
        return Amplitude(real, imag, self.sqrt2_power + sqrt2_power).normalized()

    def times(self, other: "Amplitude") -> "Amplitude":
        return Amplitude(
            self.real * other.real - self.imag * other.imag,
            self.real * other.imag + self.imag * other.real,
            self.sqrt2_power + other.sqrt2_power,
        ).normalized()

    def add(self, other: "Amplitude") -> "Amplitude":
        if self.sqrt2_power != other.sqrt2_power:
            raise ValueError("Combining amplitudes with incompatible sqrt(2) powers is not supported")
        return Amplitude(
            self.real + other.real,
            self.imag + other.imag,
            self.sqrt2_power,
        ).normalized()

    def probability(self) -> Fraction:
        normalized = self.normalized()
        if normalized.real == 0 and normalized.imag == 0:
            return Fraction(0, 1)
        return Fraction(normalized.real * normalized.real + normalized.imag * normalized.imag, 2 ** normalized.sqrt2_power)

    def to_latex(self) -> str:
        normalized = self.normalized()
        coefficient = normalized._coefficient_latex()
        if normalized.sqrt2_power == 0:
            return coefficient
        denominator = normalized._denominator_latex()
        if coefficient.startswith("-") and " + " not in coefficient and " - " not in coefficient[1:]:
            return rf"-\frac{{{coefficient[1:]}}}{{{denominator}}}"
        return rf"\frac{{{coefficient}}}{{{denominator}}}"

    def _coefficient_latex(self) -> str:
        if self.real == 0 and self.imag == 0:
            return "0"
        if self.imag == 0:
            return str(self.real)
        if self.real == 0:
            if self.imag == 1:
                return "i"
            if self.imag == -1:
                return "-i"
            return rf"{self.imag} i"

        imag_abs = abs(self.imag)
        imag_text = "i" if imag_abs == 1 else rf"{imag_abs} i"
        operator = "+" if self.imag > 0 else "-"
        return rf"{self.real} {operator} {imag_text}"

    def _denominator_latex(self) -> str:
        even_power, remainder = divmod(self.sqrt2_power, 2)
        denominator_parts: list[str] = []
        if even_power == 1:
            denominator_parts.append("2")
        elif even_power > 1:
            denominator_parts.append(rf"2^{{{even_power}}}")
        if remainder:
            denominator_parts.append(r"\sqrt{2}")
        return " ".join(denominator_parts)


@dataclass(frozen=True)
class LocalWeight:
    amplitude: Amplitude = field(default_factory=Amplitude)
    scalar: str = "1"


@dataclass
class SymbolicTerm:
    amplitude: Amplitude
    scalar: str = "1"
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)
    local_weights: dict[int, LocalWeight] | None = field(default_factory=dict)

    def clone(self) -> "SymbolicTerm":
        return SymbolicTerm(
            amplitude=self.amplitude,
            scalar=self.scalar,
            basis_bits=dict(self.basis_bits),
            payloads=dict(self.payloads),
            local_weights=None if self.local_weights is None else dict(self.local_weights),
        )


@dataclass
class LogicalSlice:
    kind: str
    controls: list[tuple[int, int]]
    target_row: int | None
    secondary_row: int | None
    span: int
    label: str
    description: str
    source_columns: list[int]
    connected_rows: list[int] = field(default_factory=list)


@dataclass
class MeasurementRenderedTerm:
    amplitude: Amplitude
    scalar: str = "1"
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)


@dataclass
class MeasurementContribution:
    amplitude: Amplitude
    scalar: str = "1"


@dataclass
class MeasurementSymbolicTerm:
    contributions: list[MeasurementContribution] = field(default_factory=list)
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)


@dataclass
class OutcomeBranch:
    outcomes: tuple[tuple[int, int], ...] = ()
    terms: list[SymbolicTerm] = field(default_factory=list)


def extract_environment_grid(source_text: str, env_index: int) -> tuple[list[str], dict[int, tuple[str, int]], list[list[str]]]:
    environments = find_quantikz_environments(source_text)
    if not environments:
        raise ValueError("No quantikz environment found")
    if env_index < 0 or env_index >= len(environments):
        raise ValueError(f"Environment index {env_index} is out of range for {len(environments)} environment(s)")

    body = strip_comments(environments[env_index].body).strip()
    raw_rows = [row.strip() for row in split_top_level(body, "\\\\") if row.strip()]
    if not raw_rows:
        raise ValueError("Selected environment does not contain any circuit rows")

    row_labels = [""] * len(raw_rows)
    label_spans: dict[int, tuple[str, int]] = {}
    row_cells: list[list[str]] = []
    for row_index, raw_row in enumerate(raw_rows):
        cells = [cell.strip() for cell in split_top_level(raw_row, "&")]
        left_label, first_remainder = parse_label_command(cells[0] if cells else "", "lstick")
        if left_label is not None:
            row_labels[row_index] = left_label.label
            label_spans[row_index] = (left_label.label, left_label.span)
            cells[0] = first_remainder
        _, last_remainder = parse_label_command(cells[-1] if cells else "", "rstick")
        if cells:
            cells[-1] = last_remainder
        row_cells.append(cells)

    column_count = max(len(cells) for cells in row_cells)
    normalized_rows = [cells + [""] * (column_count - len(cells)) for cells in row_cells]
    return row_labels, label_spans, normalized_rows


def is_noop_command(command: ParsedCommand) -> bool:
    return command.name in {"qw", "wireoverride", "raw"}


def classify_column(row_cells: list[str]) -> dict[str, object]:
    controls: list[tuple[int, int]] = []
    control_targets: list[tuple[int, int, int]] = []
    gates: list[tuple[int, int, str]] = []
    meters: list[tuple[int, int]] = []
    targets: list[int] = []
    swap_starts: list[tuple[int, int]] = []
    swap_targets: list[int] = []
    wireoverride_n_rows: list[int] = []
    connectors_to_rows: dict[int, set[int]] = {}
    substantive = False

    for row, cell in enumerate(row_cells):
        if not cell.strip():
            continue
        commands = parse_command_sequence(cell)
        for command in commands:
            if command.name == "wireoverride" and command.args and command.args[0].strip() == "n":
                wireoverride_n_rows.append(row)
                continue
            if command.name in {"control", "ocontrol"}:
                controls.append((row, 0 if command.name == "ocontrol" else 1))
                substantive = True
                continue
            if command.name in {"ctrl", "octrl"}:
                offset = parse_int(command.args[0]) if command.args else None
                if offset is None:
                    raise ValueError(f"Unsupported control offset in row {row}")
                control_targets.append((row, row + offset, 0 if command.name == "octrl" else 1))
                substantive = True
                continue
            if command.name == "gate":
                gates.append((row, parse_wires_option(command.options), command.args[0] if command.args else "?"))
                substantive = True
                continue
            if command.name == "meter":
                meters.append((row, parse_wires_option(command.options)))
                substantive = True
                continue
            if command.name == "targ":
                targets.append(row)
                substantive = True
                continue
            if command.name == "swap":
                offset = parse_int(command.args[0]) if command.args else None
                if offset is None:
                    raise ValueError(f"Unsupported swap offset in row {row}")
                swap_starts.append((row, row + offset))
                substantive = True
                continue
            if command.name == "targX":
                swap_targets.append(row)
                substantive = True
                continue
            if command.name in {"vqw", "vcw", "wire"}:
                connector = parse_connector(command, row)
                if connector is not None:
                    connectors_to_rows.setdefault(row, set()).add(connector.endpoint)
                    substantive = True
                continue
            if not is_noop_command(command):
                substantive = True

    return {
        "controls": sorted(set(controls)),
        "control_targets": sorted(set(control_targets)),
        "gates": gates,
        "meters": sorted(set(meters)),
        "targets": sorted(set(targets)),
        "swap_starts": sorted(set(swap_starts)),
        "swap_targets": sorted(set(swap_targets)),
        "wireoverride_n_rows": sorted(set(wireoverride_n_rows)),
        "connectors_to_rows": connectors_to_rows,
        "substantive": substantive,
    }


def is_compute_and_corner(column: dict[str, object]) -> tuple[bool, int | None]:
    wireoverride_rows = column["wireoverride_n_rows"]
    controls = column["controls"]
    connectors = column["connectors_to_rows"]
    gates = column["gates"]
    if gates or not wireoverride_rows or len(controls) < 2:
        return False, None

    for ancilla_row in wireoverride_rows:
        if all(control_row < ancilla_row for control_row, _ in controls):
            reachable = any(
                ancilla_row in endpoints or control_row < ancilla_row
                for control_row, endpoints in connectors.items()
                if any(control_row == control_index for control_index, _ in controls)
            )
            if reachable:
                return True, ancilla_row
    return False, None


def is_uncompute_and_corner(current_column: dict[str, object], next_column: dict[str, object]) -> tuple[bool, int | None]:
    controls = current_column["controls"]
    gates = current_column["gates"]
    if gates or len(controls) < 2 or current_column["wireoverride_n_rows"]:
        return False, None
    next_wireoverride_rows = next_column["wireoverride_n_rows"]
    if len(next_wireoverride_rows) != 1 or next_column["controls"] or next_column["gates"]:
        return False, None

    ancilla_row = next_wireoverride_rows[0]
    if all(control_row < ancilla_row for control_row, _ in controls):
        return True, ancilla_row
    return False, None


def find_connector_corner_target(column: dict[str, object]) -> int | None:
    controls = column["controls"]
    connectors = column["connectors_to_rows"]

    if (
        len(controls) < 2
        or column["gates"]
        or column["targets"]
        or column["control_targets"]
        or column["swap_starts"]
        or column["swap_targets"]
    ):
        return None

    control_rows = {row for row, _ in controls}
    candidate_rows = sorted(
        {
            endpoint
            for row, endpoints in connectors.items()
            if row in control_rows
            for endpoint in endpoints
        }
    )

    if len(candidate_rows) != 1:
        return None

    candidate_row = candidate_rows[0]
    if candidate_row in control_rows:
        return None
    return candidate_row


def gate_description(label: str) -> str:
    return rf"apply ${label.strip()}$"


def controlled_gate_description(label: str) -> str:
    return rf"controlled ${label.strip()}$"


KET_PAYLOAD_PATTERN = re.compile(r"^\\ket\{([^{}]+)\}(.*)$")


def extract_trailing_subscript(label: str) -> str | None:
    stripped = label.strip()
    if not stripped:
        return None

    if stripped.endswith("}"):
        depth = 0
        for index in range(len(stripped) - 1, -1, -1):
            char = stripped[index]
            if char == "}":
                depth += 1
            elif char == "{":
                depth -= 1
                if depth == 0:
                    if index > 0 and stripped[index - 1] == "_":
                        return stripped[index + 1 : -1].strip() or None
                    return None
            if depth < 0:
                return None
        return None

    match = re.search(r"_([A-Za-z0-9\\]+)$", stripped)
    if match is None:
        return None
    return match.group(1)


def row_wire_name(row_labels: list[str], row: int) -> str | None:
    if 0 <= row < len(row_labels):
        return extract_trailing_subscript(row_labels[row])
    return None


def row_reference(row_labels: list[str], row: int, fallback_prefix: str) -> str:
    named_reference = row_wire_name(row_labels, row)
    if named_reference is not None:
        return named_reference
    return rf"{fallback_prefix}_{{{row}}}"


def ancilla_description(action: str, row_labels: list[str], row: int) -> str:
    return rf"{action} ancilla ${row_reference(row_labels, row, 'a')}$"


def qubit_description(action: str, row_labels: list[str], row: int) -> str:
    return rf"{action} ${row_reference(row_labels, row, 'q')}$"


def controlled_qubit_description(action: str, row_labels: list[str], row: int) -> str:
    return rf"controlled {action} ${row_reference(row_labels, row, 'q')}$"


def measurement_description(row_labels: list[str], rows: list[int], controlled: bool) -> str:
    references = ", ".join(rf"${row_reference(row_labels, row, 'q')}$" for row in rows)
    if controlled:
        return f"controlled measure {references}"
    return f"measure {references}"


def parse_ket_payload(value: str) -> tuple[str, str] | None:
    normalized = " ".join(value.split())
    match = KET_PAYLOAD_PATTERN.fullmatch(normalized)
    if match is None:
        return None
    return match.group(1).strip(), match.group(2).strip()


def parse_uniform_gate_label(label: str) -> tuple[bool, str | None]:
    normalized = label.strip().replace(" ", "")
    for prefix in (r"\textsc{UNIFORM}", "UNIFORM"):
        if normalized == prefix:
            return True, None
        if not normalized.startswith(prefix + "_"):
            continue
        remainder = normalized[len(prefix) + 1 :]
        if remainder.startswith("{") and remainder.endswith("}") and len(remainder) >= 2:
            remainder = remainder[1:-1].strip()
        return True, remainder or None
    return False, None


def strip_outer_braces(value: str) -> str:
    stripped = value.strip()
    if stripped.startswith("{") and stripped.endswith("}") and len(stripped) >= 2:
        return stripped[1:-1].strip()
    return stripped


def parse_parameterized_gate_label(label: str, prefixes: tuple[str, ...]) -> str | None:
    """Return the subscript parameter if label matches a known prefix, empty string for bare match,
    or None if label does not match any prefix at all."""
    normalized = label.strip().replace(" ", "")
    for prefix in prefixes:
        if normalized == prefix:
            return ""  # bare match — gate is recognised but has no subscript parameter
        gate_prefix = prefix + "_"
        if not normalized.startswith(gate_prefix):
            continue
        remainder = strip_outer_braces(normalized[len(gate_prefix) :])
        return remainder if remainder else ""
    return None


def parse_in_gate_parameter(label: str) -> str | None:
    return parse_parameterized_gate_label(
        label,
        (
            "In",
            r"\text{In}",
            r"\mathrm{In}",
            r"\operatorname{In}",
        ),
    )


def parse_data_add_gate_parameter(label: str) -> str | None:
    return parse_parameterized_gate_label(
        label,
        (
            "data:add",
            r"\text{data:add}",
            r"\mathrm{data:add}",
            r"\operatorname{data:add}",
        ),
    )


def infer_symbolic_parameter_from_row(term: SymbolicTerm, row: int) -> str | None:
    factor = get_row_factor(term, row)
    if factor is None:
        return None
    kind, value = factor
    if kind == "basis":
        return str(value)

    payload = str(value)
    parsed = parse_ket_payload(payload)
    if parsed is not None:
        return parsed[0]

    sum_match = re.search(r"\\sum_\{([^=]+)=", payload)
    if sum_match is not None:
        return sum_match.group(1).strip()

    ket_match = re.search(r"\\ket\{([^{}]+)\}", payload)
    if ket_match is not None:
        return ket_match.group(1).strip()

    return None


def connected_rows_for_gate(column: dict[str, object], gate_row: int, gate_span: int) -> list[int]:
    adjacency: dict[int, set[int]] = {}

    def connect(left: int, right: int) -> None:
        adjacency.setdefault(left, set()).add(right)
        adjacency.setdefault(right, set()).add(left)

    for source_row, endpoints in column["connectors_to_rows"].items():
        for endpoint in endpoints:
            connect(source_row, endpoint)

    active_rows = set(range(gate_row, gate_row + gate_span))
    reachable_rows = set(active_rows)
    frontier = list(active_rows)
    while frontier:
        row = frontier.pop()
        for neighbor in adjacency.get(row, set()):
            if neighbor in reachable_rows:
                continue
            reachable_rows.add(neighbor)
            frontier.append(neighbor)

    return sorted(row for row in reachable_rows if row not in active_rows)


def uniform_index_symbol(count_symbol: str) -> str:
    match = re.search(r"[A-Za-z]", count_symbol)
    if match is None:
        return "j"
    return match.group(0).lower()


def symbolic_ket_for_row(body: str, row_labels: list[str], row: int) -> str:
    suffix = row_wire_suffix(row_labels, row) or ""
    return rf"\ket{{{body}}}{suffix}"


def row_factor_is_zero_state(factor: tuple[str, int | str] | None) -> bool:
    if factor is None:
        return False
    kind, value = factor
    if kind == "basis":
        return int(value) == 0
    parsed = parse_ket_payload(str(value))
    return parsed is not None and parsed[0] == "0"


def symbolic_ket_body(factor: tuple[str, int | str] | None) -> str | None:
    if factor is None or factor[0] != "payload":
        return None
    parsed = parse_ket_payload(str(factor[1]))
    if parsed is None:
        return None
    body, _suffix = parsed
    if body in {"0", "1", "+", "-", "i", "-i"}:
        return None
    return body


def apply_uniform_gate_to_term(
    term: SymbolicTerm,
    row: int,
    label: str,
    row_labels: list[str],
) -> list[SymbolicTerm] | None:
    matched, count_symbol = parse_uniform_gate_label(label)
    if not matched:
        return None

    current_factor = get_row_factor(term, row)
    if not row_factor_is_zero_state(current_factor):
        return None

    updated = term.clone()
    if count_symbol is None:
        wire_name = row_wire_name(row_labels, row)
        if wire_name is None:
            return None
        set_row_factor(updated, row, ("payload", symbolic_ket_for_row(wire_name, row_labels, row)))
        set_row_local_weight(updated, row, LocalWeight())
        return [updated]

    index_symbol = row_wire_name(row_labels, row) or uniform_index_symbol(count_symbol)
    expression = rf"\frac{{1}}{{\sqrt{{{count_symbol}}}}} \sum_{{{index_symbol}=0}}^{{{count_symbol}-1}} \ket{{{index_symbol}}}"
    suffix = row_wire_suffix(row_labels, row)
    if suffix is not None:
        expression = rf"\left({expression}\right){suffix}"
    set_row_factor(updated, row, ("payload", expression))
    set_row_local_weight(updated, row, LocalWeight())
    return [updated]


def propagate_symbolic_control_to_target(
    term: SymbolicTerm,
    controls: list[tuple[int, int]],
    target_row: int,
    row_labels: list[str],
) -> bool:
    symbolic_control_body: str | None = None
    for control_row, expected in controls:
        basis_value = term.basis_bits.get(control_row)
        if basis_value is not None:
            if basis_value != expected:
                return False
            continue

        control_body = symbolic_ket_body(get_row_factor(term, control_row))
        if control_body is None or expected != 1:
            return False
        if symbolic_control_body is not None:
            return False
        symbolic_control_body = control_body

    if symbolic_control_body is None:
        return False
    if not row_factor_is_zero_state(get_row_factor(term, target_row)):
        return False

    set_row_factor(term, target_row, ("payload", symbolic_ket_for_row(symbolic_control_body, row_labels, target_row)))
    set_row_local_weight(term, target_row, LocalWeight())
    return True


def resolve_control_bit(
    term: SymbolicTerm,
    row: int,
    classical_controls: dict[int, int] | None = None,
) -> int | None:
    basis_value = term.basis_bits.get(row)
    if basis_value is not None:
        return basis_value
    if classical_controls is None:
        return None
    return classical_controls.get(row)


def controls_match(
    term: SymbolicTerm,
    controls: list[tuple[int, int]],
    classical_controls: dict[int, int] | None = None,
) -> bool:
    return all(resolve_control_bit(term, row, classical_controls) == expected for row, expected in controls)


def controls_for_connected_rows(column: dict[str, object], active_rows: set[int]) -> list[tuple[int, int]]:
    expected_by_row: dict[int, int] = {}
    for row, expected in column["controls"]:
        expected_by_row[row] = expected
    for row, _target_row, expected in column["control_targets"]:
        existing = expected_by_row.get(row)
        if existing is not None and existing != expected:
            raise ValueError(f"Control row {row} mixes filled and empty expectations in one column")
        expected_by_row[row] = expected

    adjacency: dict[int, set[int]] = {}

    def connect(left: int, right: int) -> None:
        adjacency.setdefault(left, set()).add(right)
        adjacency.setdefault(right, set()).add(left)

    for source_row, endpoints in column["connectors_to_rows"].items():
        for endpoint in endpoints:
            connect(source_row, endpoint)

    for row, target_row, _expected in column["control_targets"]:
        connect(row, target_row)

    reachable_rows = set(active_rows)
    frontier = list(active_rows)
    while frontier:
        row = frontier.pop()
        for neighbor in adjacency.get(row, set()):
            if neighbor in reachable_rows:
                continue
            reachable_rows.add(neighbor)
            frontier.append(neighbor)

    return sorted(
        (row, expected)
        for row, expected in expected_by_row.items()
        if row not in active_rows and row in reachable_rows
    )


def controls_for_gate_span(column: dict[str, object], gate_row: int, gate_span: int) -> list[tuple[int, int]]:
    return controls_for_connected_rows(column, set(range(gate_row, gate_row + gate_span)))


def build_logical_slices(row_labels: list[str], grid: list[list[str]]) -> list[LogicalSlice]:
    physical_columns = list(zip(*grid))
    columns = [classify_column(list(column)) for column in physical_columns]
    logical_slices: list[LogicalSlice] = []
    active_temporary_rows: set[int] = set()
    index = 0
    while index < len(columns):
        current = columns[index]
        column_slices: list[tuple[int, int, LogicalSlice]] = []

        and_pattern_matched = False

        compute, compute_row = is_compute_and_corner(current)
        if compute and compute_row is not None:
            column_slices.append(
                (
                    compute_row,
                    0,
                    LogicalSlice(
                        kind="and_compute",
                        controls=list(current["controls"]),
                        target_row=compute_row,
                        secondary_row=None,
                        span=1,
                        label=rf"\text{{compute AND into ancilla }}a_{{{compute_row}}}",
                        description=ancilla_description("compute AND into", row_labels, compute_row),
                        source_columns=[index],
                    ),
                )
            )
            active_temporary_rows.add(compute_row)
            and_pattern_matched = True

        if not and_pattern_matched:
            connector_corner_target = find_connector_corner_target(current)
            if connector_corner_target is not None and not row_labels[connector_corner_target].strip():
                is_uncompute = connector_corner_target in active_temporary_rows
                column_slices.append(
                    (
                        connector_corner_target,
                        0,
                        LogicalSlice(
                            kind="and_uncompute" if is_uncompute else "and_compute",
                            controls=list(current["controls"]),
                            target_row=connector_corner_target,
                            secondary_row=None,
                            span=1,
                            label=(
                                rf"\text{{uncompute AND and remove ancilla }}a_{{{connector_corner_target}}}"
                                if is_uncompute
                                else rf"\text{{compute AND into ancilla }}a_{{{connector_corner_target}}}"
                            ),
                            description=(
                                ancilla_description("uncompute AND and remove", row_labels, connector_corner_target)
                                if is_uncompute
                                else ancilla_description("compute AND into", row_labels, connector_corner_target)
                            ),
                            source_columns=[index],
                        ),
                    )
                )
                if is_uncompute:
                    active_temporary_rows.discard(connector_corner_target)
                else:
                    active_temporary_rows.add(connector_corner_target)
                and_pattern_matched = True

        skip_next = False
        if not and_pattern_matched and index + 1 < len(columns):
            uncompute, uncompute_row = is_uncompute_and_corner(current, columns[index + 1])
            if uncompute and uncompute_row is not None:
                column_slices.append(
                    (
                        uncompute_row,
                        0,
                        LogicalSlice(
                            kind="and_uncompute",
                            controls=list(current["controls"]),
                            target_row=uncompute_row,
                            secondary_row=None,
                            span=1,
                            label=rf"\text{{uncompute AND and remove ancilla }}a_{{{uncompute_row}}}",
                            description=ancilla_description("uncompute AND and remove", row_labels, uncompute_row),
                            source_columns=[index, index + 1],
                        ),
                    )
                )
                active_temporary_rows.discard(uncompute_row)
                skip_next = True
                and_pattern_matched = True

        used_swap_targets: set[int] = set()
        for swap_row, swap_endpoint in current["swap_starts"]:
            if swap_endpoint not in current["swap_targets"]:
                raise ValueError(f"Swap from row {swap_row} is missing a matching \\targX endpoint at row {swap_endpoint}")
            if swap_endpoint in used_swap_targets:
                raise ValueError(f"Swap target marker at row {swap_endpoint} is reused within the same logical slice")
            used_swap_targets.add(swap_endpoint)
            top_row = min(swap_row, swap_endpoint)
            bottom_row = max(swap_row, swap_endpoint)
            controls = controls_for_connected_rows(current, set(range(top_row, bottom_row + 1)))
            column_slices.append(
                (
                    top_row,
                    1,
                    LogicalSlice(
                        kind="swap",
                        controls=controls,
                        target_row=top_row,
                        secondary_row=bottom_row,
                        span=1,
                        label="SWAP",
                        description=(
                            rf"controlled swap between ${row_reference(row_labels, top_row, 'q')}$ and ${row_reference(row_labels, bottom_row, 'q')}$"
                            if controls
                            else rf"swap ${row_reference(row_labels, top_row, 'q')}$ and ${row_reference(row_labels, bottom_row, 'q')}$"
                        ),
                        source_columns=[index],
                    ),
                )
            )
        unused_swap_targets = sorted(set(current["swap_targets"]) - used_swap_targets)
        if unused_swap_targets:
            raise ValueError(f"Swap target marker at row {unused_swap_targets[0]} is missing a matching \\swap")

        for gate_row, gate_span, gate_label in current["gates"]:
            controls = controls_for_gate_span(current, gate_row, gate_span)
            connected_rows = connected_rows_for_gate(current, gate_row, gate_span)
            column_slices.append(
                (
                    gate_row,
                    1,
                    LogicalSlice(
                        kind="controlled_gate" if controls else "gate",
                        controls=controls,
                        target_row=gate_row,
                        secondary_row=None,
                        span=gate_span,
                        label=gate_label,
                        description=controlled_gate_description(gate_label) if controls else gate_description(gate_label),
                        source_columns=[index],
                        connected_rows=connected_rows,
                    ),
                )
            )

        for target_row in current["targets"]:
            controls = controls_for_connected_rows(current, {target_row})
            if not controls:
                continue
            column_slices.append(
                (
                    target_row,
                    1,
                    LogicalSlice(
                        kind="controlled_x",
                        controls=controls,
                        target_row=target_row,
                        secondary_row=None,
                        span=1,
                        label="X",
                        description=rf"controlled $X$ on ${row_reference(row_labels, target_row, 'a')}$",
                        source_columns=[index],
                    ),
                )
            )

        for measured_row, measure_span in current["meters"]:
            measured_rows = set(range(measured_row, measured_row + measure_span))
            controls = controls_for_connected_rows(current, measured_rows)
            column_slices.append(
                (
                    measured_row,
                    2,
                    LogicalSlice(
                        kind="measure",
                        controls=controls,
                        target_row=measured_row,
                        secondary_row=None,
                        span=measure_span,
                        label="measure",
                        description=measurement_description(
                            row_labels,
                            list(range(measured_row, measured_row + measure_span)),
                            bool(controls),
                        ),
                        source_columns=[index],
                    ),
                )
            )

        logical_slices.extend(slice_info for _, _, slice_info in sorted(column_slices, key=lambda item: (item[1], item[0])))
        index += 2 if skip_next else 1

    return logical_slices


def apply_initial_state_symbol(term: SymbolicTerm, row: int, symbol: str) -> list[SymbolicTerm]:
    if symbol == "0":
        updated = term.clone()
        updated.basis_bits[row] = 0
        set_row_local_weight(updated, row, LocalWeight())
        return [updated]
    if symbol == "1":
        updated = term.clone()
        updated.basis_bits[row] = 1
        set_row_local_weight(updated, row, LocalWeight())
        return [updated]
    if symbol == "+":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        set_row_local_weight(zero_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sqrt2_power=1)
        one_term.basis_bits[row] = 1
        set_row_local_weight(one_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))
        return [zero_term, one_term]
    if symbol == "-":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        set_row_local_weight(zero_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sign=-1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        set_row_local_weight(
            one_term,
            row,
            LocalWeight(amplitude=Amplitude(real=-1, imag=0, sqrt2_power=1)),
        )
        return [zero_term, one_term]
    if symbol == "i":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        set_row_local_weight(zero_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(i_power=1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        set_row_local_weight(
            one_term,
            row,
            LocalWeight(amplitude=Amplitude(real=0, imag=1, sqrt2_power=1)),
        )
        return [zero_term, one_term]
    if symbol == "T":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        set_row_local_weight(zero_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.times(Amplitude(real=1, imag=1, sqrt2_power=2))
        one_term.basis_bits[row] = 1
        set_row_local_weight(
            one_term,
            row,
            LocalWeight(amplitude=Amplitude(real=1, imag=1, sqrt2_power=2)),
        )
        return [zero_term, one_term]
    if symbol == "-i":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        set_row_local_weight(zero_term, row, LocalWeight(amplitude=Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(i_power=-1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        set_row_local_weight(
            one_term,
            row,
            LocalWeight(amplitude=Amplitude(real=0, imag=-1, sqrt2_power=1)),
        )
        return [zero_term, one_term]
    raise ValueError(f"Unsupported initial-state symbol: {symbol}")


def make_initial_terms(
    row_labels: list[str],
    label_spans: dict[int, tuple[str, int]],
    temporary_rows: set[int],
) -> list[SymbolicTerm]:
    terms = [SymbolicTerm(amplitude=Amplitude())]
    consumed: set[int] = set()

    for row in range(len(row_labels)):
        if row in consumed or row in temporary_rows:
            continue
        span_entry = label_spans.get(row)
        label = span_entry[0] if span_entry is not None else row_labels[row]
        span = span_entry[1] if span_entry is not None else 1
        if not label.strip():
            label = r"\ket{0}"
            span = 1

        covered_rows = list(range(row, row + span))
        consumed.update(covered_rows)
        symbols = parse_product_state_symbols(label, span)
        next_terms: list[SymbolicTerm] = []
        for term in terms:
            if symbols is not None:
                partial_terms = [term]
                for target_row, symbol in zip(covered_rows, symbols):
                    expanded_terms: list[SymbolicTerm] = []
                    for partial_term in partial_terms:
                        expanded_terms.extend(apply_initial_state_symbol(partial_term, target_row, symbol))
                    partial_terms = expanded_terms
                next_terms.extend(partial_terms)
            else:
                updated = term.clone()
                updated.payloads[row] = label
                set_row_local_weight(updated, row, LocalWeight())
                next_terms.append(updated)
        terms = next_terms

    return terms


def is_named_single_qubit_gate(label: str) -> bool:
    normalized = canonical_gate_label(label)
    return normalized in {"H", "S", "Sdg", "T", "Tdg", "X", "Y", "Z"} or parse_pauli_rotation_label(normalized) is not None


def parse_pauli_rotation_label(label: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"R([XYZ])\((.*)\)", label)
    if match is None:
        return None
    return match.group(1), match.group(2).strip()


@dataclass(frozen=True)
class ScalarNumber:
    value: Fraction


@dataclass(frozen=True)
class ScalarAtom:
    latex: str


@dataclass(frozen=True)
class ScalarAdd:
    terms: tuple["ScalarExpr", ...]


@dataclass(frozen=True)
class ScalarMul:
    factors: tuple["ScalarExpr", ...]


@dataclass(frozen=True)
class ScalarDiv:
    numerator: "ScalarExpr"
    denominator: "ScalarExpr"


@dataclass(frozen=True)
class ScalarSqrt:
    value: "ScalarExpr"


ScalarExpr = ScalarNumber | ScalarAtom | ScalarAdd | ScalarMul | ScalarDiv | ScalarSqrt


class ScalarExpressionParser:
    def __init__(self, text: str):
        self.text = text
        self.index = 0

    def parse(self) -> ScalarExpr:
        expression = self.parse_expression()
        self.skip_whitespace()
        if self.index != len(self.text):
            raise ValueError(f"Unexpected trailing scalar expression text: {self.text[self.index:]}")
        return expression

    def parse_expression(self) -> ScalarExpr:
        left = self.parse_term()
        terms = [left]
        while True:
            self.skip_whitespace()
            if self.index >= len(self.text) or self.text[self.index] not in "+-":
                break
            operator = self.text[self.index]
            self.index += 1
            right = self.parse_term()
            if operator == "+":
                terms.append(right)
            else:
                terms.append(ScalarMul((ScalarNumber(Fraction(-1, 1)), right)))
        if len(terms) == 1:
            return terms[0]
        return ScalarAdd(tuple(terms))

    def parse_term(self) -> ScalarExpr:
        factors = [self.parse_factor()]
        while True:
            self.skip_whitespace()
            if self.index >= len(self.text):
                break
            if self.text[self.index] in "+-)}":
                break
            if self.text[self.index] == "\\" and self.text.startswith(r"\right", self.index):
                break
            factors.append(self.parse_factor())
        if len(factors) == 1:
            return factors[0]
        return ScalarMul(tuple(factors))

    def parse_factor(self) -> ScalarExpr:
        self.skip_whitespace()
        if self.index < len(self.text) and self.text[self.index] == "-":
            self.index += 1
            return ScalarMul((ScalarNumber(Fraction(-1, 1)), self.parse_factor()))
        return self.parse_primary()

    def parse_primary(self) -> ScalarExpr:
        self.skip_whitespace()
        if self.index >= len(self.text):
            raise ValueError("Unexpected end of scalar expression")

        if self.text[self.index] == "{":
            return self.parse_group("{", "}")
        if self.text[self.index] == "(":
            return self.parse_group("(", ")")
        if self.text[self.index].isdigit():
            return self.parse_number()
        if self.text[self.index] == "\\":
            return self.parse_command()
        return self.parse_identifier()

    def parse_group(self, open_char: str, close_char: str) -> ScalarExpr:
        if self.text[self.index] != open_char:
            raise ValueError(f"Expected {open_char} in scalar expression")
        self.index += 1
        expression = self.parse_expression()
        self.skip_whitespace()
        if self.index >= len(self.text) or self.text[self.index] != close_char:
            raise ValueError(f"Expected {close_char} in scalar expression")
        self.index += 1
        return expression

    def parse_number(self) -> ScalarExpr:
        start = self.index
        while self.index < len(self.text) and self.text[self.index].isdigit():
            self.index += 1
        return ScalarNumber(Fraction(int(self.text[start:self.index]), 1))

    def parse_identifier(self) -> ScalarExpr:
        start = self.index
        while self.index < len(self.text) and re.match(r"[A-Za-z0-9]", self.text[self.index]):
            self.index += 1
        if start == self.index:
            raise ValueError(f"Unsupported scalar atom starting at: {self.text[self.index:]}")
        return ScalarAtom(self.text[start:self.index])

    def parse_command(self) -> ScalarExpr:
        if self.text.startswith(r"\frac", self.index):
            self.index += len(r"\frac")
            numerator = self.parse_fraction_argument()
            denominator = self.parse_fraction_argument()
            return ScalarDiv(numerator, denominator)
        if self.text.startswith(r"\sqrt", self.index):
            self.index += len(r"\sqrt")
            self.skip_whitespace()
            return ScalarSqrt(self.parse_group("{", "}"))

        command_name = self.parse_command_name()
        if command_name in {r"\cos", r"\sin", r"\exp"}:
            return ScalarAtom(self.extract_function_atom(command_name))
        return ScalarAtom(command_name)

    def parse_command_name(self) -> str:
        start = self.index
        self.index += 1
        while self.index < len(self.text) and self.text[self.index].isalpha():
            self.index += 1
        return self.text[start:self.index]

    def parse_fraction_argument(self) -> ScalarExpr:
        self.skip_whitespace()
        if self.index >= len(self.text):
            raise ValueError("Unexpected end of scalar expression")
        if self.index < len(self.text) and self.text[self.index] in "{(":
            open_char = self.text[self.index]
            close_char = "}" if open_char == "{" else ")"
            return self.parse_group(open_char, close_char)
        if self.text[self.index] == "\\":
            return self.parse_command()
        if self.text[self.index].isdigit():
            digit = self.text[self.index]
            self.index += 1
            return ScalarNumber(Fraction(int(digit), 1))
        if re.match(r"[A-Za-z]", self.text[self.index]):
            identifier = self.text[self.index]
            self.index += 1
            return ScalarAtom(identifier)
        return self.parse_primary()

    def extract_function_atom(self, command_name: str) -> str:
        start = self.index - len(command_name)
        self.skip_whitespace()
        if self.text.startswith(r"\left(", self.index):
            self.index += len(r"\left(")
            depth = 1
            while self.index < len(self.text):
                if self.text.startswith(r"\left(", self.index):
                    depth += 1
                    self.index += len(r"\left(")
                    continue
                if self.text.startswith(r"\right)", self.index):
                    depth -= 1
                    self.index += len(r"\right)")
                    if depth == 0:
                        return self.text[start:self.index]
                    continue
                self.index += 1
            raise ValueError(f"Unclosed {command_name} argument in scalar expression")
        if self.index < len(self.text) and self.text[self.index] in "({":
            open_char = self.text[self.index]
            close_char = ")" if open_char == "(" else "}"
            group_start = self.index
            self.parse_group(open_char, close_char)
            return self.text[start:self.index]
        return command_name

    def skip_whitespace(self) -> None:
        while self.index < len(self.text) and self.text[self.index].isspace():
            self.index += 1


def parse_scalar_expression(text: str) -> ScalarExpr:
    return ScalarExpressionParser(text).parse()


def is_zero_scalar_expr(expression: ScalarExpr) -> bool:
    return isinstance(expression, ScalarNumber) and expression.value == 0


def is_one_scalar_expr(expression: ScalarExpr) -> bool:
    return isinstance(expression, ScalarNumber) and expression.value == 1


def perfect_square_factor(value: int) -> tuple[int, int]:
    if value <= 1:
        return value, 1
    root = int(value ** 0.5)
    while root > 1:
        square = root * root
        if value % square == 0:
            return root, value // square
        root -= 1
    return 1, value


def simplify_scalar_expression(expression: ScalarExpr) -> ScalarExpr:
    if isinstance(expression, (ScalarNumber, ScalarAtom)):
        return expression

    if isinstance(expression, ScalarAdd):
        terms: list[ScalarExpr] = []
        constant = Fraction(0, 1)
        for term in expression.terms:
            simplified_term = simplify_scalar_expression(term)
            if isinstance(simplified_term, ScalarAdd):
                nested_terms = simplified_term.terms
            else:
                nested_terms = (simplified_term,)
            for nested_term in nested_terms:
                if isinstance(nested_term, ScalarNumber):
                    constant += nested_term.value
                else:
                    terms.append(nested_term)
        if constant != 0:
            terms.insert(0, ScalarNumber(constant))
        if not terms:
            return ScalarNumber(Fraction(0, 1))
        if len(terms) == 1:
            return terms[0]
        return ScalarAdd(tuple(terms))

    if isinstance(expression, ScalarMul):
        factors: list[ScalarExpr] = []
        sqrt_factors: list[ScalarExpr] = []
        constant = Fraction(1, 1)
        for factor in expression.factors:
            simplified_factor = simplify_scalar_expression(factor)
            if isinstance(simplified_factor, ScalarMul):
                nested_factors = simplified_factor.factors
            else:
                nested_factors = (simplified_factor,)
            for nested_factor in nested_factors:
                if isinstance(nested_factor, ScalarNumber):
                    constant *= nested_factor.value
                elif isinstance(nested_factor, ScalarSqrt):
                    sqrt_factors.append(nested_factor.value)
                else:
                    factors.append(nested_factor)
        if constant == 0:
            return ScalarNumber(Fraction(0, 1))
        if len(sqrt_factors) > 1:
            factors.append(simplify_scalar_expression(ScalarSqrt(ScalarMul(tuple(sqrt_factors)))))
        elif sqrt_factors:
            factors.append(simplify_scalar_expression(ScalarSqrt(sqrt_factors[0])))
        if constant != 1 or not factors:
            factors.insert(0, ScalarNumber(constant))
        factors = [factor for factor in factors if not is_one_scalar_expr(factor)]
        if not factors:
            return ScalarNumber(Fraction(1, 1))
        if len(factors) == 1:
            return factors[0]
        return ScalarMul(tuple(factors))

    if isinstance(expression, ScalarDiv):
        numerator = simplify_scalar_expression(expression.numerator)
        denominator = simplify_scalar_expression(expression.denominator)
        if is_zero_scalar_expr(numerator):
            return ScalarNumber(Fraction(0, 1))
        if isinstance(numerator, ScalarNumber) and isinstance(denominator, ScalarNumber):
            return ScalarNumber(numerator.value / denominator.value)
        if isinstance(denominator, ScalarNumber) and denominator.value == 1:
            return numerator
        if isinstance(denominator, ScalarNumber) and denominator.value < 0:
            return simplify_scalar_expression(
                ScalarMul((ScalarNumber(Fraction(-1, 1)), ScalarDiv(numerator, ScalarNumber(-denominator.value))))
            )
        return ScalarDiv(numerator, denominator)

    inner = simplify_scalar_expression(expression.value)
    if isinstance(inner, ScalarNumber):
        numerator_factor = int(inner.value.numerator)
        denominator_factor = int(inner.value.denominator)
        numerator_root, numerator_remainder = perfect_square_factor(abs(numerator_factor))
        denominator_root, denominator_remainder = perfect_square_factor(denominator_factor)
        coefficient = Fraction(numerator_root, denominator_root)
        remainder_numerator = numerator_remainder if numerator_factor >= 0 else -numerator_remainder
        if remainder_numerator < 0:
            return ScalarSqrt(inner)
        if remainder_numerator == 1 and denominator_remainder == 1:
            return ScalarNumber(coefficient)
        if remainder_numerator == 1:
            return simplify_scalar_expression(
                ScalarDiv(
                    ScalarNumber(coefficient),
                    ScalarSqrt(ScalarNumber(Fraction(denominator_remainder, 1))),
                )
            )
        remaining = ScalarNumber(Fraction(remainder_numerator, denominator_remainder))
        if coefficient == 1:
            return ScalarSqrt(remaining)
        return simplify_scalar_expression(ScalarMul((ScalarNumber(coefficient), ScalarSqrt(remaining))))
    if isinstance(inner, ScalarMul):
        constant = Fraction(1, 1)
        other_factors: list[ScalarExpr] = []
        for factor in inner.factors:
            if isinstance(factor, ScalarNumber):
                constant *= factor.value
            else:
                other_factors.append(factor)
        if constant > 0 and constant != 1:
            rest = ScalarNumber(Fraction(1, 1)) if not other_factors else (
                other_factors[0] if len(other_factors) == 1 else ScalarMul(tuple(other_factors))
            )
            coefficient = simplify_scalar_expression(ScalarSqrt(ScalarNumber(constant)))
            if is_one_scalar_expr(rest):
                return coefficient
            return simplify_scalar_expression(ScalarMul((coefficient, ScalarSqrt(rest))))
    if is_one_scalar_expr(inner):
        return ScalarNumber(Fraction(1, 1))
    return ScalarSqrt(inner)


def scalar_expr_precedence(expression: ScalarExpr) -> int:
    if isinstance(expression, ScalarAdd):
        return 1
    if isinstance(expression, (ScalarMul, ScalarDiv)):
        return 2
    return 3


def scalar_expr_is_negative(expression: ScalarExpr) -> tuple[bool, ScalarExpr]:
    if isinstance(expression, ScalarNumber):
        if expression.value < 0:
            return True, ScalarNumber(-expression.value)
        return False, expression
    if isinstance(expression, ScalarMul) and expression.factors and isinstance(expression.factors[0], ScalarNumber) and expression.factors[0].value < 0:
        positive_first = ScalarNumber(-expression.factors[0].value)
        remaining = (positive_first,) + expression.factors[1:]
        return True, simplify_scalar_expression(ScalarMul(remaining))
    return False, expression


def absorbable_square_for_render(expression: ScalarExpr) -> ScalarExpr | None:
    simplified = simplify_scalar_expression(expression)
    if isinstance(simplified, ScalarNumber):
        if simplified.value < 0:
            return None
        return ScalarNumber(simplified.value * simplified.value)
    if isinstance(simplified, ScalarSqrt):
        return simplified.value
    if isinstance(simplified, ScalarDiv):
        numerator_square = absorbable_square_for_render(simplified.numerator)
        denominator_square = absorbable_square_for_render(simplified.denominator)
        if numerator_square is None or denominator_square is None:
            return None
        return simplify_scalar_expression(ScalarDiv(numerator_square, denominator_square))
    if isinstance(simplified, ScalarMul):
        squared_factors: list[ScalarExpr] = []
        for factor in simplified.factors:
            factor_square = absorbable_square_for_render(factor)
            if factor_square is None:
                return None
            squared_factors.append(factor_square)
        if not squared_factors:
            return ScalarNumber(Fraction(1, 1))
        if len(squared_factors) == 1:
            return squared_factors[0]
        return simplify_scalar_expression(ScalarMul(tuple(squared_factors)))
    return None


def render_scalar_mul_single_sqrt(expression: ScalarMul, *, parent_precedence: int = 0) -> str | None:
    negative, positive_expression = scalar_expr_is_negative(expression)
    factors = positive_expression.factors if isinstance(positive_expression, ScalarMul) else (positive_expression,)
    if not any(isinstance(factor, ScalarSqrt) for factor in factors):
        return None

    residual_factors: list[ScalarExpr] = []
    absorbed_factors: list[ScalarExpr] = []
    for factor in factors:
        squared_factor = absorbable_square_for_render(factor)
        if squared_factor is None:
            residual_factors.append(factor)
            continue
        absorbed_factors.append(squared_factor)

    if not absorbed_factors:
        return None

    absorbed_radicand = (
        absorbed_factors[0]
        if len(absorbed_factors) == 1
        else simplify_scalar_expression(ScalarMul(tuple(absorbed_factors)))
    )
    rendered_sqrt = rf"\sqrt{{{render_scalar_expression(absorbed_radicand)}}}"

    rendered_factors: list[str] = []
    for factor in residual_factors:
        if scalar_expr_precedence(factor) >= scalar_expr_precedence(expression):
            rendered_factors.append(
                render_scalar_expression(factor, parent_precedence=scalar_expr_precedence(expression))
            )
        else:
            rendered_factors.append(f"({render_scalar_expression(factor)})")
    rendered_factors.append(rendered_sqrt)
    rendered = " ".join(rendered_factors)
    if negative:
        rendered = f"-{rendered}"
    if parent_precedence > scalar_expr_precedence(expression):
        return f"({rendered})"
    return rendered


def render_scalar_expression(expression: ScalarExpr, *, parent_precedence: int = 0) -> str:
    if isinstance(expression, ScalarNumber):
        return render_fraction_latex(expression.value)
    if isinstance(expression, ScalarAtom):
        return expression.latex
    if isinstance(expression, ScalarSqrt):
        return rf"\sqrt{{{render_scalar_expression(expression.value)}}}"
    if isinstance(expression, ScalarDiv):
        return rf"\frac{{{render_scalar_expression(expression.numerator)}}}{{{render_scalar_expression(expression.denominator)}}}"
    if isinstance(expression, ScalarMul):
        single_sqrt = render_scalar_mul_single_sqrt(expression, parent_precedence=parent_precedence)
        if single_sqrt is not None:
            return single_sqrt
        rendered = " ".join(
            render_scalar_expression(factor, parent_precedence=scalar_expr_precedence(expression))
            if scalar_expr_precedence(factor) >= scalar_expr_precedence(expression)
            else f"({render_scalar_expression(factor)})"
            for factor in expression.factors
        )
        if parent_precedence > scalar_expr_precedence(expression):
            return f"({rendered})"
        return rendered
    pieces: list[str] = []
    for index, term in enumerate(expression.terms):
        negative, positive_term = scalar_expr_is_negative(term)
        rendered_term = render_scalar_expression(positive_term, parent_precedence=scalar_expr_precedence(expression))
        if scalar_expr_precedence(positive_term) < scalar_expr_precedence(expression):
            rendered_term = f"({rendered_term})"
        if index == 0:
            pieces.append(f"-{rendered_term}" if negative else rendered_term)
            continue
        pieces.append(f"- {rendered_term}" if negative else f"+ {rendered_term}")
    rendered = " ".join(pieces)
    if parent_precedence > scalar_expr_precedence(expression):
        return f"({rendered})"
    return rendered


def normalize_scalar_latex(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return stripped
    try:
        return render_scalar_expression(simplify_scalar_expression(parse_scalar_expression(stripped)))
    except ValueError:
        return stripped


def scalar_probability_expression(expression: ScalarExpr) -> ScalarExpr:
    simplified = simplify_scalar_expression(expression)
    if isinstance(simplified, ScalarNumber):
        return ScalarNumber(simplified.value * simplified.value)
    if isinstance(simplified, ScalarSqrt):
        return simplify_scalar_expression(simplified.value)
    if isinstance(simplified, ScalarMul):
        return simplify_scalar_expression(ScalarMul(tuple(scalar_probability_expression(factor) for factor in simplified.factors)))
    if isinstance(simplified, ScalarDiv):
        return simplify_scalar_expression(
            ScalarDiv(
                scalar_probability_expression(simplified.numerator),
                scalar_probability_expression(simplified.denominator),
            )
        )
    if isinstance(simplified, ScalarAtom):
        if simplified.latex.startswith(r"\exp\left("):
            return ScalarNumber(Fraction(1, 1))
        if simplified.latex.startswith(r"\cos\left("):
            return ScalarAtom(simplified.latex.replace(r"\cos\left", r"\cos^2\left", 1))
        if simplified.latex.startswith(r"\sin\left("):
            return ScalarAtom(simplified.latex.replace(r"\sin\left", r"\sin^2\left", 1))
        return ScalarAtom(rf"\left|{simplified.latex}\right|^2")
    return ScalarAtom(rf"\left|{render_scalar_expression(simplified)}\right|^2")


def render_half_angle(angle: str) -> str:
    return rf"\frac{{{angle}}}{{2}}"


def unwrap_enclosed_expression(text: str, open_char: str, close_char: str) -> str | None:
    stripped = text.strip()
    if not stripped.startswith(open_char) or not stripped.endswith(close_char):
        return None

    depth = 0
    for index, char in enumerate(stripped):
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0 and index != len(stripped) - 1:
                return None
        if depth < 0:
            return None

    if depth != 0:
        return None
    return stripped[1:-1]


def strip_outer_grouping(expression: str) -> str:
    stripped = expression.strip()
    while True:
        for open_char, close_char in (("{", "}"), ("(", ")")):
            inner = unwrap_enclosed_expression(stripped, open_char, close_char)
            if inner is not None:
                stripped = inner.strip()
                break
        else:
            return stripped


def extract_function_argument(text: str) -> str | None:
    stripped = text.strip()
    if not stripped:
        return None
    for open_char, close_char in (("{", "}"), ("(", ")")):
        inner = unwrap_enclosed_expression(stripped, open_char, close_char)
        if inner is not None:
            return inner.strip()
    return stripped


def extract_sqrt_argument(expression: str) -> str | None:
    stripped = strip_outer_grouping(expression)
    if not stripped.startswith(r"\sqrt"):
        return None
    remainder = stripped[len(r"\sqrt") :]
    inner = unwrap_enclosed_expression(remainder, "{", "}")
    if inner is None:
        return None
    return inner.strip()


def negate_scalar(scalar: str) -> str:
    stripped = normalize_scalar_latex(scalar)
    if stripped == "1":
        return "-1"
    if stripped == "-1":
        return "1"
    if stripped.startswith("-"):
        return stripped[1:].strip()
    return f"-{stripped}"


def wrap_product_factor(expression: str) -> str:
    stripped = strip_outer_grouping(expression)
    if re.fullmatch(r"[A-Za-z0-9]+", stripped):
        return stripped
    if re.fullmatch(r"\\[A-Za-z]+(?:_\{[^{}]+\}|_[A-Za-z0-9]+)?", stripped):
        return stripped
    return f"({stripped})"


def multiply_radicands(left: str, right: str) -> str:
    return f"{wrap_product_factor(left)}{wrap_product_factor(right)}"


def multiply_scalar_factors(left: str, right: str) -> str:
    left_stripped = normalize_scalar_latex(left)
    right_stripped = normalize_scalar_latex(right)
    if left_stripped == "0" or right_stripped == "0":
        return "0"
    if left_stripped == "1":
        return right_stripped
    if right_stripped == "1":
        return left_stripped
    if left_stripped == "-1":
        return negate_scalar(right_stripped)
    if right_stripped == "-1":
        return negate_scalar(left_stripped)
    if left_stripped.startswith("-"):
        return negate_scalar(multiply_scalar_factors(left_stripped[1:].strip(), right_stripped))
    if right_stripped.startswith("-"):
        return negate_scalar(multiply_scalar_factors(left_stripped, right_stripped[1:].strip()))

    try:
        expression = simplify_scalar_expression(
            ScalarMul((parse_scalar_expression(left_stripped), parse_scalar_expression(right_stripped)))
        )
        return render_scalar_expression(expression)
    except ValueError:
        left_sqrt = extract_sqrt_argument(left_stripped)
        right_sqrt = extract_sqrt_argument(right_stripped)
        if left_sqrt is not None and right_sqrt is not None:
            return normalize_scalar_latex(rf"\sqrt{{{multiply_radicands(left_sqrt, right_sqrt)}}}")
        return normalize_scalar_latex(f"{left_stripped} {right_stripped}")


def parse_double_inverse_trig_angle(angle: str) -> tuple[str, str] | None:
    normalized = angle.replace(" ", "")
    for function_name in (r"\arccos", r"\arcsin"):
        for prefix in (f"2{function_name}", f"2*{function_name}"):
            if not normalized.startswith(prefix):
                continue
            argument = extract_function_argument(normalized[len(prefix) :])
            if argument is not None:
                return function_name, argument
    return None


def complementary_half_angle_factor(argument: str) -> str:
    sqrt_argument = extract_sqrt_argument(argument)
    if sqrt_argument is not None:
        try:
            inner_expression = parse_scalar_expression(sqrt_argument)
            return render_scalar_expression(
                simplify_scalar_expression(
                    ScalarSqrt(
                        ScalarAdd(
                            (
                                ScalarNumber(Fraction(1, 1)),
                                ScalarMul((ScalarNumber(Fraction(-1, 1)), inner_expression)),
                            )
                        )
                    )
                )
            )
        except ValueError:
            return normalize_scalar_latex(rf"\sqrt{{1-{strip_outer_grouping(sqrt_argument)}}}")

    normalized_argument = normalize_scalar_latex(argument)
    try:
        return render_scalar_expression(
            simplify_scalar_expression(
                ScalarSqrt(
                    ScalarAdd(
                        (
                            ScalarNumber(Fraction(1, 1)),
                            ScalarMul((ScalarNumber(Fraction(-1, 1)), parse_scalar_expression(normalized_argument))),
                        )
                    )
                )
            )
        )
    except ValueError:
        base = strip_outer_grouping(normalized_argument)
        if re.fullmatch(r"[A-Za-z0-9]+", base) or re.fullmatch(r"\\[A-Za-z]+", base):
            squared = rf"{base}^2"
        else:
            squared = rf"({base})^2"
        return normalize_scalar_latex(rf"\sqrt{{1-{squared}}}")


def simplify_half_angle_trig(angle: str, trig_function: str) -> str | None:
    parsed = parse_double_inverse_trig_angle(angle)
    if parsed is None:
        return None

    function_name, argument = parsed
    if function_name == r"\arccos":
        if trig_function == "cos":
            return normalize_scalar_latex(argument)
        return complementary_half_angle_factor(argument)
    if trig_function == "sin":
        return normalize_scalar_latex(argument)
    return complementary_half_angle_factor(argument)


def half_angle_trig_factor(angle: str, trig_function: str) -> str:
    simplified = simplify_half_angle_trig(angle, trig_function)
    if simplified is not None:
        return simplified
    return normalize_scalar_latex(rf"\{trig_function}\left({render_half_angle(angle)}\right)")


def pauli_rotation_basis_branches(axis: str, angle: str, bit: int) -> list[tuple[int, Amplitude, str]]:
    cosine = half_angle_trig_factor(angle, "cos")
    sine = half_angle_trig_factor(angle, "sin")
    if axis == "X":
        if bit == 0:
            return [
                (0, Amplitude(), cosine),
                (1, Amplitude(real=0, imag=-1), sine),
            ]
        return [
            (0, Amplitude(real=0, imag=-1), sine),
            (1, Amplitude(), cosine),
        ]
    if axis == "Y":
        if bit == 0:
            return [
                (0, Amplitude(), cosine),
                (1, Amplitude(), sine),
            ]
        return [
            (0, Amplitude(real=-1), sine),
            (1, Amplitude(), cosine),
        ]
    if axis == "Z":
        phase = rf"\exp\left({'-' if bit == 0 else ''}i {render_half_angle(angle)}\right)"
        return [(bit, Amplitude(), phase)]
    raise ValueError(f"Unsupported Pauli rotation axis: {axis}")


def merge_symbolic_terms(terms: list[SymbolicTerm]) -> list[SymbolicTerm]:
    grouped: dict[tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...], str], SymbolicTerm] = {}

    for term in terms:
        key = (
            tuple(sorted(term.basis_bits.items())),
            tuple(sorted(term.payloads.items())),
            term.scalar,
        )
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = term
            continue

        try:
            combined_amplitude = existing.amplitude.add(term.amplitude)
        except ValueError as exc:
            raise ValueError(
                "Combining equal symbolic states with incompatible amplitudes is not supported"
            ) from exc

        if combined_amplitude.to_latex() == "0":
            grouped.pop(key, None)
            continue

        existing.amplitude = combined_amplitude
        existing.local_weights = None

    return list(grouped.values())


def apply_operator(label: str, factor: str) -> str:
    if factor.startswith(label):
        return factor
    return f"{label}{factor}"


def get_row_factor(term: SymbolicTerm, row: int) -> tuple[str, int | str] | None:
    if row in term.basis_bits:
        return ("basis", term.basis_bits[row])
    if row in term.payloads:
        return ("payload", term.payloads[row])
    return None


def set_row_factor(term: SymbolicTerm, row: int, factor: tuple[str, int | str] | None) -> None:
    term.basis_bits.pop(row, None)
    term.payloads.pop(row, None)
    if factor is None:
        return
    kind, value = factor
    if kind == "basis":
        term.basis_bits[row] = int(value)
        return
    term.payloads[row] = str(value)


def get_row_local_weight(term: SymbolicTerm, row: int) -> LocalWeight | None:
    if term.local_weights is None:
        return None
    return term.local_weights.get(row, LocalWeight())


def set_row_local_weight(term: SymbolicTerm, row: int, weight: LocalWeight | None) -> None:
    if term.local_weights is None:
        return
    if weight is None:
        term.local_weights.pop(row, None)
        return
    term.local_weights[row] = weight


def multiply_local_weight(
    weight: LocalWeight,
    amplitude_factor: Amplitude | None = None,
    scalar_factor: str = "1",
) -> LocalWeight:
    updated_amplitude = weight.amplitude if amplitude_factor is None else weight.amplitude.times(amplitude_factor)
    return LocalWeight(
        amplitude=updated_amplitude,
        scalar=multiply_scalar_factors(weight.scalar, scalar_factor),
    )


def combine_local_weights(weights: list[LocalWeight]) -> LocalWeight:
    amplitude = Amplitude()
    scalar = "1"
    for weight in weights:
        amplitude = amplitude.times(weight.amplitude)
        scalar = multiply_scalar_factors(scalar, weight.scalar)
    return LocalWeight(amplitude=amplitude, scalar=scalar)


def row_factor_expression(term: SymbolicTerm, row: int) -> str | None:
    if row in term.basis_bits:
        return rf"\ket{{{term.basis_bits[row]}}}"
    return term.payloads.get(row)


def apply_named_gate_to_basis_term(term: SymbolicTerm, row: int, label: str) -> list[SymbolicTerm] | None:
    if row not in term.basis_bits:
        return None

    bit = term.basis_bits[row]
    normalized_label = canonical_gate_label(label)
    rotation = parse_pauli_rotation_label(normalized_label)
    row_weight = get_row_local_weight(term, row)

    if rotation is not None:
        axis, angle = rotation
        branches: list[SymbolicTerm] = []
        for updated_bit, amplitude_factor, scalar_factor in pauli_rotation_basis_branches(axis, angle, bit):
            updated = term.clone()
            updated.amplitude = updated.amplitude.times(amplitude_factor)
            updated.scalar = multiply_scalar_factors(updated.scalar, scalar_factor)
            updated.basis_bits[row] = updated_bit
            if row_weight is not None:
                set_row_local_weight(updated, row, multiply_local_weight(row_weight, amplitude_factor, scalar_factor))
            if updated.amplitude.to_latex() != "0" and updated.scalar != "0":
                branches.append(updated)
        return branches

    if normalized_label == "H":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0
        if row_weight is not None:
            set_row_local_weight(zero_term, row, multiply_local_weight(row_weight, Amplitude(sqrt2_power=1)))

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sign=-1 if bit == 1 else 1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        if row_weight is not None:
            set_row_local_weight(
                one_term,
                row,
                multiply_local_weight(
                    row_weight,
                    Amplitude(real=-1 if bit == 1 else 1, imag=0, sqrt2_power=1),
                ),
            )
        return [zero_term, one_term]

    updated = term.clone()
    if normalized_label == "X":
        updated.basis_bits[row] = 1 - bit
    elif normalized_label == "Y":
        updated.basis_bits[row] = 1 - bit
        updated.amplitude = updated.amplitude.multiply(sign=-1 if bit == 1 else 1, i_power=1)
        if row_weight is not None:
            set_row_local_weight(
                updated,
                row,
                multiply_local_weight(
                    row_weight,
                    Amplitude(real=0, imag=-1 if bit == 1 else 1),
                ),
            )
    elif normalized_label == "Z":
        if bit == 1:
            updated.amplitude = updated.amplitude.multiply(sign=-1)
            if row_weight is not None:
                set_row_local_weight(updated, row, multiply_local_weight(row_weight, Amplitude(real=-1)))
    elif normalized_label == "S":
        if bit == 1:
            updated.amplitude = updated.amplitude.multiply(i_power=1)
            if row_weight is not None:
                set_row_local_weight(updated, row, multiply_local_weight(row_weight, Amplitude(real=0, imag=1)))
    elif normalized_label == "Sdg":
        if bit == 1:
            updated.amplitude = updated.amplitude.multiply(i_power=-1)
            if row_weight is not None:
                set_row_local_weight(updated, row, multiply_local_weight(row_weight, Amplitude(real=0, imag=-1)))
    elif normalized_label == "T":
        if bit == 1:
            updated.amplitude = updated.amplitude.times(Amplitude(real=1, imag=1, sqrt2_power=1))
            if row_weight is not None:
                set_row_local_weight(
                    updated,
                    row,
                    multiply_local_weight(row_weight, Amplitude(real=1, imag=1, sqrt2_power=1)),
                )
    elif normalized_label == "Tdg":
        if bit == 1:
            updated.amplitude = updated.amplitude.times(Amplitude(real=1, imag=-1, sqrt2_power=1))
            if row_weight is not None:
                set_row_local_weight(
                    updated,
                    row,
                    multiply_local_weight(row_weight, Amplitude(real=1, imag=-1, sqrt2_power=1)),
                )
    else:
        return None

    return [updated]


def apply_gate_to_term(
    term: SymbolicTerm,
    target_row: int,
    span: int,
    label: str,
    row_labels: list[str],
    connected_rows: list[int] | None = None,
) -> list[SymbolicTerm]:
    if span == 1:
        in_parameter = parse_in_gate_parameter(label)
        if in_parameter is not None:
            return [term.clone()]

        data_add_parameter = parse_data_add_gate_parameter(label)
        if data_add_parameter is not None and (connected_rows or data_add_parameter):
            input_symbol = None
            for source_row in connected_rows:
                input_symbol = infer_symbolic_parameter_from_row(term, source_row)
                if input_symbol is not None:
                    break
            if input_symbol is None:
                input_symbol = data_add_parameter

            updated = term.clone()
            target_factor = get_row_factor(updated, target_row)
            if target_factor is None:
                raise ValueError(f"Gate target row {target_row} has no symbolic factor to act on")

            if row_factor_is_zero_state(target_factor):
                set_row_factor(updated, target_row, ("payload", symbolic_ket_for_row(input_symbol, row_labels, target_row)))
                return [updated]

            target_expression = row_factor_expression(updated, target_row)
            if target_expression is None:
                raise ValueError(f"Gate target row {target_row} has no symbolic factor to act on")

            parsed_target = parse_ket_payload(target_expression)
            target_body = parsed_target[0] if parsed_target is not None else target_expression
            xor_body = rf"{target_body} \oplus {input_symbol}"
            set_row_factor(updated, target_row, ("payload", symbolic_ket_for_row(xor_body, row_labels, target_row)))
            return [updated]

    components = decompose_tensor_product_gate_label(label, span)
    if components is not None:
        evolved_terms = [term.clone()]
        for row, component in zip(range(target_row, target_row + span), components):
            next_terms: list[SymbolicTerm] = []
            for evolved_term in evolved_terms:
                if component == "I":
                    next_terms.append(evolved_term)
                    continue
                uniform_terms = apply_uniform_gate_to_term(evolved_term, row, component, row_labels)
                if uniform_terms is not None:
                    next_terms.extend(uniform_terms)
                    continue
                if is_named_single_qubit_gate(component):
                    named_terms = apply_named_gate_to_basis_term(evolved_term, row, component)
                    if named_terms is not None:
                        next_terms.extend(named_terms)
                        continue
                current = row_factor_expression(evolved_term, row)
                if current is None:
                    raise ValueError(f"Gate target row {row} has no symbolic factor to act on")
                evolved_term.basis_bits.pop(row, None)
                evolved_term.payloads[row] = apply_operator(component, current)
                next_terms.append(evolved_term)
            evolved_terms = next_terms
        return evolved_terms

    if span == 1:
        uniform_terms = apply_uniform_gate_to_term(term, target_row, label, row_labels)
        if uniform_terms is not None:
            return uniform_terms

    updated = term.clone()
    factors: list[str] = []
    local_weights: list[LocalWeight] = []
    for row in range(target_row, target_row + span):
        current = row_factor_expression(updated, row)
        if current is None:
            raise ValueError(f"Gate target row {row} has no symbolic factor to act on")
        factors.append(current)
        if updated.local_weights is not None:
            local_weights.append(get_row_local_weight(updated, row) or LocalWeight())
        updated.basis_bits.pop(row, None)
        updated.payloads.pop(row, None)
        set_row_local_weight(updated, row, None)

    factor_body = r" \otimes ".join(factors)
    if span > 1:
        factor_body = rf"\left({factor_body}\right)"
    updated.payloads[target_row] = apply_operator(label, factor_body)
    if updated.local_weights is not None:
        set_row_local_weight(updated, target_row, combine_local_weights(local_weights))
    return [updated]


def evolve_terms(
    terms: list[SymbolicTerm],
    slice_info: LogicalSlice,
    row_labels: list[str],
    classical_controls: dict[int, int] | None = None,
) -> list[SymbolicTerm]:
    next_terms: list[SymbolicTerm] = []
    for term in terms:
        updated = term.clone()
        if slice_info.kind == "and_compute":
            assert slice_info.target_row is not None
            resolved_controls: list[bool] = []
            for row, expected in slice_info.controls:
                control_value = resolve_control_bit(updated, row, classical_controls)
                if control_value is None:
                    raise ValueError(f"AND control row {row} is not in the computational basis")
                resolved_controls.append(control_value == expected)
            control_value = int(all(resolved_controls))
            updated.basis_bits[slice_info.target_row] = control_value
            set_row_local_weight(updated, slice_info.target_row, LocalWeight())
        elif slice_info.kind == "and_uncompute":
            assert slice_info.target_row is not None
            updated.basis_bits.pop(slice_info.target_row, None)
            set_row_local_weight(updated, slice_info.target_row, None)
        elif slice_info.kind == "controlled_x":
            assert slice_info.target_row is not None
            if controls_match(updated, slice_info.controls, classical_controls):
                current_value = updated.basis_bits.get(slice_info.target_row)
                if current_value is not None:
                    updated.basis_bits[slice_info.target_row] = 1 - current_value
                else:
                    current = row_factor_expression(updated, slice_info.target_row)
                    if current is None:
                        raise ValueError(f"Controlled X target row {slice_info.target_row} has no symbolic factor to act on")
                    updated.payloads[slice_info.target_row] = apply_operator("X", current)
            elif not propagate_symbolic_control_to_target(updated, slice_info.controls, slice_info.target_row, row_labels):
                next_terms.append(updated)
                continue
        elif slice_info.kind == "swap":
            assert slice_info.target_row is not None
            assert slice_info.secondary_row is not None
            if controls_match(updated, slice_info.controls, classical_controls):
                left_factor = get_row_factor(updated, slice_info.target_row)
                right_factor = get_row_factor(updated, slice_info.secondary_row)
                left_weight = get_row_local_weight(updated, slice_info.target_row)
                right_weight = get_row_local_weight(updated, slice_info.secondary_row)
                set_row_factor(updated, slice_info.target_row, right_factor)
                set_row_factor(updated, slice_info.secondary_row, left_factor)
                set_row_local_weight(updated, slice_info.target_row, right_weight)
                set_row_local_weight(updated, slice_info.secondary_row, left_weight)
        elif slice_info.kind == "gate":
            assert slice_info.target_row is not None
            next_terms.extend(
                apply_gate_to_term(
                    updated,
                    slice_info.target_row,
                    slice_info.span,
                    slice_info.label,
                    row_labels,
                    slice_info.connected_rows,
                )
            )
            continue
        elif slice_info.kind == "controlled_gate":
            assert slice_info.target_row is not None
            if controls_match(updated, slice_info.controls, classical_controls):
                next_terms.extend(
                    apply_gate_to_term(
                        updated,
                        slice_info.target_row,
                        slice_info.span,
                        slice_info.label,
                        row_labels,
                        slice_info.connected_rows,
                    )
                )
                continue
        elif slice_info.kind == "measure":
            next_terms.append(updated)
            continue
        else:
            raise ValueError(f"Unsupported logical slice kind: {slice_info.kind}")
        next_terms.append(updated)
    return merge_symbolic_terms(next_terms)


def render_fraction_latex(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return rf"\frac{{{value.numerator}}}{{{value.denominator}}}"


def split_top_level_space_factors(value: str) -> list[str]:
    stripped = value.strip()
    if not stripped:
        return []

    factors: list[str] = []
    start = 0
    paren_depth = 0
    brace_depth = 0

    for index, char in enumerate(stripped):
        if char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
        elif char == "{":
            brace_depth += 1
        elif char == "}":
            brace_depth -= 1
        elif char.isspace() and paren_depth == 0 and brace_depth == 0:
            factor = stripped[start:index].strip()
            if factor:
                factors.append(factor)
            start = index + 1

    trailing = stripped[start:].strip()
    if trailing:
        factors.append(trailing)
    return factors


def scalar_probability_factor_latex(factor: str) -> str:
    stripped = factor.strip()
    if not stripped or stripped in {"1", "-1"}:
        return "1"
    if stripped.startswith("-"):
        return scalar_probability_factor_latex(stripped[1:].strip())
    if stripped.startswith(r"\exp\left(") and stripped.endswith(r"\right)"):
        return "1"
    sqrt_argument = extract_sqrt_argument(stripped)
    if sqrt_argument is not None:
        return sqrt_argument
    if stripped.startswith(r"\cos\left(") and stripped.endswith(r"\right)"):
        return stripped.replace(r"\cos\left", r"\cos^2\left", 1)
    if stripped.startswith(r"\sin\left(") and stripped.endswith(r"\right)"):
        return stripped.replace(r"\sin\left", r"\sin^2\left", 1)
    return rf"\left|{stripped}\right|^2"


def multiply_latex_factors(left: str, right: str) -> str:
    left_stripped = left.strip()
    right_stripped = right.strip()
    if left_stripped == "0" or right_stripped == "0":
        return "0"
    if left_stripped == "1":
        return right_stripped
    if right_stripped == "1":
        return left_stripped
    return f"{left_stripped} {right_stripped}"


def scalar_probability_latex(scalar: str) -> str:
    try:
        probability = scalar_probability_expression(parse_scalar_expression(normalize_scalar_latex(scalar)))
        return render_scalar_expression(simplify_scalar_expression(probability))
    except ValueError:
        result = "1"
        for factor in split_top_level_space_factors(scalar):
            result = multiply_latex_factors(result, scalar_probability_factor_latex(factor))
        return result


def render_measurement_probability_contribution(amplitude: Amplitude, scalar: str) -> str:
    amplitude_probability = amplitude.probability()
    if amplitude_probability == 0:
        return "0"

    scalar_probability = scalar_probability_latex(scalar)
    amplitude_text = render_fraction_latex(amplitude_probability)
    if scalar_probability == "1":
        return amplitude_text
    if amplitude_probability == 1:
        return scalar_probability
    return f"{amplitude_text} {scalar_probability}"


def render_measurement_coefficient(amplitude: Amplitude, scalar: str) -> str:
    scalar_text = normalize_scalar_latex(scalar)
    effective_amplitude = amplitude
    if scalar_text.startswith("-"):
        scalar_text = scalar_text[1:].strip()
        effective_amplitude = effective_amplitude.multiply(sign=-1)

    amplitude_text = effective_amplitude.to_latex()
    if scalar_text == "1":
        return amplitude_text
    if amplitude_text == "1":
        return scalar_text
    if amplitude_text == "-1":
        return f"-{scalar_text}"
    return f"{amplitude_text} {scalar_text}"


def measurement_symbolic_term_key(term: MeasurementSymbolicTerm) -> tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]]:
    return (
        tuple(sorted(term.basis_bits.items())),
        tuple(sorted(term.payloads.items())),
    )


def group_terms_by_measurement_state(terms: list[SymbolicTerm]) -> list[MeasurementSymbolicTerm]:
    grouped: dict[
        tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]],
        MeasurementSymbolicTerm,
    ] = {}

    for term in terms:
        contribution = MeasurementContribution(
            amplitude=term.amplitude,
            scalar=term.scalar,
        )
        if contribution.amplitude.to_latex() == "0" or contribution.scalar == "0":
            continue

        projected = MeasurementSymbolicTerm(
            contributions=[contribution],
            basis_bits=dict(term.basis_bits),
            payloads=dict(term.payloads),
        )
        key = measurement_symbolic_term_key(projected)
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = projected
            continue

        merged = False
        for existing_contribution in existing.contributions:
            if existing_contribution.scalar != contribution.scalar:
                continue
            existing_contribution.amplitude = existing_contribution.amplitude.add(contribution.amplitude)
            merged = True
            break
        if not merged:
            existing.contributions.append(contribution)

        existing.contributions = [
            current
            for current in existing.contributions
            if current.amplitude.to_latex() != "0" and current.scalar != "0"
        ]

    return [
        grouped_term
        for _, grouped_term in sorted(
            grouped.items(),
            key=lambda item: (
                item[0][0],
                item[0][1],
            ),
        )
        if grouped_term.contributions
    ]


def measurement_factor_options(term: SymbolicTerm, row: int) -> list[tuple[int, Amplitude]]:
    if row in term.basis_bits:
        return [(term.basis_bits[row], Amplitude())]

    payload = term.payloads.get(row)
    if payload is None:
        raise ValueError(f"Measured row {row} has no state to measure")

    normalized = payload.replace(" ", "")
    if normalized == r"\ket{0}":
        return [(0, Amplitude())]
    if normalized == r"\ket{1}":
        return [(1, Amplitude())]
    if normalized == r"X\ket{0}":
        return [(1, Amplitude())]
    if normalized == r"X\ket{1}":
        return [(0, Amplitude())]
    if normalized == r"Y\ket{0}":
        return [(1, Amplitude(real=0, imag=1))]
    if normalized == r"Y\ket{1}":
        return [(0, Amplitude(real=0, imag=-1))]
    if normalized == r"Z\ket{0}":
        return [(0, Amplitude())]
    if normalized == r"Z\ket{1}":
        return [(1, Amplitude(real=-1))]
    if normalized == r"S\ket{0}":
        return [(0, Amplitude())]
    if normalized == r"S\ket{1}":
        return [(1, Amplitude(real=0, imag=1))]
    if normalized == r"T\ket{0}":
        return [(0, Amplitude())]
    if normalized == r"T\ket{1}":
        return [(1, Amplitude(real=1, imag=1, sqrt2_power=1))]
    if normalized == r"Tdg\ket{0}":
        return [(0, Amplitude())]
    if normalized == r"Tdg\ket{1}":
        return [(1, Amplitude(real=1, imag=-1, sqrt2_power=1))]
    if normalized == r"H\ket{0}":
        return [
            (0, Amplitude(sqrt2_power=1)),
            (1, Amplitude(sqrt2_power=1)),
        ]
    if normalized == r"H\ket{1}":
        return [
            (0, Amplitude(sqrt2_power=1)),
            (1, Amplitude(real=-1, sqrt2_power=1)),
        ]
    raise ValueError(
        f"Measurement on row {row} is only supported for computational-basis states and simple H/S/T/Tdg/X/Y/Z-applied basis states"
    )


def measurement_outcome_options(
    term: SymbolicTerm,
    measured_rows: list[int],
) -> list[tuple[tuple[tuple[int, int], ...], Amplitude]]:
    options: list[tuple[tuple[tuple[int, int], ...], Amplitude]] = [((), Amplitude())]
    for row in measured_rows:
        next_options: list[tuple[tuple[tuple[int, int], ...], Amplitude]] = []
        for existing_outcomes, existing_amplitude in options:
            for outcome, factor_amplitude in measurement_factor_options(term, row):
                next_options.append(
                    (
                        existing_outcomes + ((row, outcome),),
                        existing_amplitude.times(factor_amplitude),
                    )
                )
        options = next_options
    return options


def measurement_term_key(term: MeasurementRenderedTerm) -> tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...], str]:
    return (
        tuple(sorted(term.basis_bits.items())),
        tuple(sorted(term.payloads.items())),
        term.scalar,
    )


def render_scalar_weighted_expression(amplitude: Amplitude, scalar: str, expression: str) -> str:
    scalar_text = normalize_scalar_latex(scalar)
    coefficient = multiply_scalar_factors(amplitude.to_latex(), scalar_text)
    # Remove redundant '1' in coefficients like '1 i', '-1 i', '1/2', etc.
    if coefficient == "1":
        return expression
    if coefficient == "-1":
        return f"-{expression}"
    # Remove '1 ' prefix
    if coefficient.startswith("1 "):
        coefficient = coefficient[2:]
    if coefficient.startswith("-1 "):
        coefficient = "-" + coefficient[3:]
    # Remove '+1 ' and '-1 ' in sums (e.g., '+1 i', '-1 i')
    coefficient = re.sub(r'([+-])1 ', r'\1', coefficient)
    return f"{coefficient} {expression}"


def wrap_tensor_factor(factor: str, *, wrap_sums: bool = False) -> str:
    stripped = factor.strip()
    if re.fullmatch(r"\\left\(.*\\right\)(?:_\{[^{}]+\}|_[A-Za-z0-9\\]+)?", stripped):
        return stripped
    if " + " in stripped or " - " in stripped[1:]:
        return rf"\left({stripped}\right)"
    if wrap_sums and r"\sum" in stripped:
        return rf"\left({stripped}\right)"
    return stripped


def parse_uniform_superposition_factor(factor: str) -> tuple[str, str, str] | None:
    stripped = factor.strip()
    outer_match = re.fullmatch(r"\\left\((.*)\\right\)(.*)", stripped)
    if outer_match is None:
        return None

    inner_expression = outer_match.group(1).strip()
    suffix = outer_match.group(2).strip()
    uniform_match = re.fullmatch(
        r"\\frac\{1\}\{\\sqrt\{(.+)\}\} \\sum_\{([^=]+)=0\}\^\{(.+)-1\} \\ket\{([^{}]+)\}",
        inner_expression,
    )
    if uniform_match is None:
        return None

    count_symbol = uniform_match.group(1).strip()
    sum_index = uniform_match.group(2).strip()
    upper_symbol = uniform_match.group(3).strip()
    ket_symbol = uniform_match.group(4).strip()
    if sum_index != ket_symbol or upper_symbol != count_symbol:
        return None
    return count_symbol, sum_index, suffix


def render_correlated_uniform_tensor(factors: list[str]) -> str | None:
    uniform_position: int | None = None
    uniform_count: str | None = None
    shared_index: str | None = None
    source_suffix: str | None = None

    for position, factor in enumerate(factors):
        parsed_uniform = parse_uniform_superposition_factor(factor)
        if parsed_uniform is None:
            continue
        if uniform_position is not None:
            return None
        uniform_position = position
        uniform_count, shared_index, source_suffix = parsed_uniform

    if uniform_position is None or uniform_count is None or shared_index is None or source_suffix is None:
        return None

    tensor_factors: list[str] = []
    has_additional_correlated_factor = False
    for position, factor in enumerate(factors):
        if position == uniform_position:
            tensor_factors.append(rf"\ket{{{shared_index}}}{source_suffix}")
            continue

        parsed_ket = parse_ket_payload(factor.strip())
        if parsed_ket is None:
            tensor_factors.append(factor)
            continue
        body, suffix = parsed_ket
        if body.strip() != shared_index:
            tensor_factors.append(factor)
            continue

        has_additional_correlated_factor = True
        tensor_factors.append(rf"\ket{{{shared_index}}}{suffix}")

    if not has_additional_correlated_factor:
        return None

    tensor_expression = r" \otimes ".join(tensor_factors)
    return rf"\frac{{1}}{{\sqrt{{{uniform_count}}}}} \sum_{{{shared_index}=0}}^{{{uniform_count}-1}} {tensor_expression}"


def render_measurement_term(term: MeasurementRenderedTerm, row_order: list[int]) -> str:
    factors: list[str] = []
    index = 0
    active_rows = [row for row in row_order if row in term.basis_bits or row in term.payloads]
    while index < len(active_rows):
        row = active_rows[index]
        if row in term.basis_bits:
            bits = [str(term.basis_bits[row])]
            index += 1
            while index < len(active_rows) and active_rows[index] in term.basis_bits:
                bits.append(str(term.basis_bits[active_rows[index]]))
                index += 1
            factors.append(rf"\ket{{{''.join(bits)}}}")
            continue
        factors.append(wrap_tensor_factor(term.payloads[row], wrap_sums=True))
        index += 1

    factor_body = r" \otimes ".join(factors)
    if not factor_body:
        return render_measurement_coefficient(term.amplitude, term.scalar)
    return render_scalar_weighted_expression(term.amplitude, term.scalar, factor_body)


def render_measurement_symbolic_term(term: MeasurementSymbolicTerm, row_order: list[int]) -> str:
    factors: list[str] = []
    index = 0
    active_rows = [row for row in row_order if row in term.basis_bits or row in term.payloads]
    while index < len(active_rows):
        row = active_rows[index]
        if row in term.basis_bits:
            bits = [str(term.basis_bits[row])]
            index += 1
            while index < len(active_rows) and active_rows[index] in term.basis_bits:
                bits.append(str(term.basis_bits[active_rows[index]]))
                index += 1
            factors.append(rf"\ket{{{''.join(bits)}}}")
            continue
        factors.append(wrap_tensor_factor(term.payloads[row], wrap_sums=True))
        index += 1

    factor_body = r" \otimes ".join(factors)
    contribution_texts = [
        render_measurement_coefficient(contribution.amplitude, contribution.scalar)
        for contribution in term.contributions
        if contribution.amplitude.to_latex() != "0" and contribution.scalar != "0"
    ]
    if not contribution_texts:
        return "0"

    coefficient = " + ".join(contribution_texts).replace("+ -", "- ")
    if not factor_body:
        return coefficient
    if coefficient == "1":
        return factor_body
    if coefficient == "-1":
        return f"-{factor_body}"
    if len(contribution_texts) > 1:
        coefficient = rf"\left({coefficient}\right)"
    return f"{coefficient} {factor_body}"


def render_terms_probability_latex(terms: list[SymbolicTerm]) -> str:
    if all(term.scalar == "1" for term in terms):
        probability = sum((term.amplitude.probability() for term in terms), start=Fraction(0, 1))
        return render_fraction_latex(probability)

    grouped_terms = group_terms_by_measurement_state(terms)
    probability_pieces: list[str] = []

    for grouped_term in grouped_terms:
        if len(grouped_term.contributions) == 1:
            contribution = grouped_term.contributions[0]
            probability_piece = render_measurement_probability_contribution(contribution.amplitude, contribution.scalar)
        else:
            coefficient = " + ".join(
                render_measurement_coefficient(contribution.amplitude, contribution.scalar)
                for contribution in grouped_term.contributions
            ).replace("+ -", "- ")
            probability_piece = rf"\left|{coefficient}\right|^2"
        if probability_piece != "0":
            probability_pieces.append(probability_piece)

    if not probability_pieces:
        return "0"
    return " + ".join(probability_pieces).replace("+ -", "- ")


def render_branch_terms_latex(terms: list[SymbolicTerm], row_order: list[int]) -> str:
    if any(term.scalar != "1" for term in terms):
        grouped_terms = group_terms_by_measurement_state(terms)
        branch_expr = " + ".join(
            render_measurement_symbolic_term(grouped_term, row_order)
            for grouped_term in grouped_terms
        ).replace("+ -", "- ")
        if len(grouped_terms) > 1:
            return rf"\left({branch_expr}\right)"
        return branch_expr

    rendered_terms = [
        render_measurement_term(
            MeasurementRenderedTerm(
                amplitude=term.amplitude,
                scalar=term.scalar,
                basis_bits=dict(term.basis_bits),
                payloads=dict(term.payloads),
            ),
            row_order,
        )
        for term in sorted(
            terms,
            key=lambda current: (
                tuple(sorted(current.basis_bits.items())),
                tuple(sorted(current.payloads.items())),
                current.scalar,
            ),
        )
    ]
    branch_expr = " + ".join(rendered_terms).replace("+ -", "- ")
    if len(rendered_terms) > 1:
        return rf"\left({branch_expr}\right)"
    return branch_expr


def project_measurement_terms(
    terms: list[SymbolicTerm],
    measured_rows: list[int],
) -> dict[tuple[tuple[int, int], ...], list[SymbolicTerm]]:
    grouped: dict[tuple[tuple[int, int], ...], list[SymbolicTerm]] = {}

    for term in terms:
        for outcomes, factor_amplitude in measurement_outcome_options(term, measured_rows):
            projected = term.clone()
            projected.amplitude = projected.amplitude.times(factor_amplitude)
            for row in measured_rows:
                projected.basis_bits.pop(row, None)
                projected.payloads.pop(row, None)
                set_row_local_weight(projected, row, None)
            if projected.amplitude.to_latex() == "0" or projected.scalar == "0":
                continue
            grouped.setdefault(outcomes, []).append(projected)

    projected_branches: dict[tuple[tuple[int, int], ...], list[SymbolicTerm]] = {}
    for outcomes, branch_terms in grouped.items():
        merged_terms = merge_symbolic_terms(branch_terms)
        if merged_terms:
            projected_branches[outcomes] = merged_terms
    return projected_branches


def outcome_label(outcomes: tuple[tuple[int, int], ...], row_labels: list[str], probability: str) -> str:
    assignments = ", ".join(
        f"{row_reference(row_labels, row, 'q')}={outcome}"
        for row, outcome in outcomes
    )
    return rf"\Pr({assignments})={probability}"


def wrap_additive_expression(expression: str) -> str:
    stripped = expression.strip()
    if stripped.startswith(r"\left(") and stripped.endswith(r"\right)"):
        return stripped
    if " + " in stripped or " - " in stripped[1:]:
        return rf"\Bigl({stripped}\Bigr)"
    return stripped


def render_normalized_branch_state(terms: list[SymbolicTerm], row_order: list[int], row_labels: list[str]) -> str:
    branch_expr = render_branch_terms_latex(terms, row_order)
    probability = render_terms_probability_latex(terms)
    if probability == "1":
        return branch_expr
    return rf"\frac{{1}}{{\sqrt{{{probability}}}}} {wrap_additive_expression(branch_expr)}"


def branch_terms_signature(terms: list[SymbolicTerm]) -> tuple[tuple[object, ...], ...]:
    return tuple(
        sorted(
            (
                tuple(sorted(term.basis_bits.items())),
                tuple(sorted(term.payloads.items())),
                term.scalar,
                term.amplitude.real,
                term.amplitude.imag,
                term.amplitude.sqrt2_power,
            )
            for term in terms
        )
    )


def render_branches_state_latex(
    branches: list[OutcomeBranch],
    row_order: list[int],
    row_labels: list[str],
    *,
    collapse_identical_branches: bool = True,
) -> str:
    if len(branches) == 1 and not branches[0].outcomes:
        return render_state_latex(branches[0].terms, row_order, row_labels)

    # If classically controlled corrections make all branch states equal, collapse to one expression.
    signatures = {branch_terms_signature(branch.terms) for branch in branches}
    if collapse_identical_branches and len(signatures) == 1 and branches:
        return render_state_latex(branches[0].terms, row_order, row_labels)

    pieces: list[str] = []
    for branch in sorted(branches, key=lambda current: current.outcomes):
        branch_expr = render_normalized_branch_state(branch.terms, row_order, row_labels)
        if not branch.outcomes:
            pieces.append(branch_expr)
            continue
        label = outcome_label(branch.outcomes, row_labels, render_terms_probability_latex(branch.terms))
        pieces.append(rf"{branch_expr}, & {label}")

    return r"\begin{cases}" + r" \\ ".join(pieces) + r"\end{cases}"


def merge_outcome_branches(branches: list[OutcomeBranch]) -> list[OutcomeBranch]:
    grouped: dict[tuple[tuple[int, int], ...], list[SymbolicTerm]] = {}
    for branch in branches:
        grouped.setdefault(branch.outcomes, []).extend(branch.terms)

    merged_branches: list[OutcomeBranch] = []
    for outcomes, terms in sorted(grouped.items(), key=lambda item: item[0]):
        merged_terms = merge_symbolic_terms(terms)
        if merged_terms:
            merged_branches.append(OutcomeBranch(outcomes=outcomes, terms=merged_terms))
    return merged_branches


def project_measurement_terms_exact(
    terms: list[SymbolicTerm],
    measured_row: int,
) -> dict[int, list[MeasurementRenderedTerm]]:
    grouped: dict[
        int,
        dict[tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...], str], MeasurementRenderedTerm],
    ] = {}

    for term in terms:
        for outcome, factor_amplitude in measurement_factor_options(term, measured_row):
            projected = MeasurementRenderedTerm(
                amplitude=term.amplitude.times(factor_amplitude),
                scalar=term.scalar,
                basis_bits=dict(term.basis_bits),
                payloads=dict(term.payloads),
            )
            projected.basis_bits.pop(measured_row, None)
            projected.payloads.pop(measured_row, None)
            key = measurement_term_key(projected)
            branch = grouped.setdefault(outcome, {})
            existing = branch.get(key)
            if existing is None:
                branch[key] = projected
            else:
                combined = existing.amplitude.add(projected.amplitude)
                branch[key] = MeasurementRenderedTerm(
                    amplitude=combined,
                    scalar=existing.scalar,
                    basis_bits=existing.basis_bits,
                    payloads=existing.payloads,
                )

    projected_branches: dict[int, list[MeasurementRenderedTerm]] = {}
    for outcome, branch_terms in grouped.items():
        projected_branches[outcome] = [
            branch_term
            for branch_term in branch_terms.values()
            if branch_term.amplitude.to_latex() != "0"
        ]
    return projected_branches


def project_measurement_terms_symbolic(
    terms: list[SymbolicTerm],
    measured_row: int,
) -> dict[int, list[MeasurementSymbolicTerm]]:
    grouped: dict[
        int,
        dict[tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]], MeasurementSymbolicTerm],
    ] = {}

    for term in terms:
        for outcome, factor_amplitude in measurement_factor_options(term, measured_row):
            contribution = MeasurementContribution(
                amplitude=term.amplitude.times(factor_amplitude),
                scalar=term.scalar,
            )
            if contribution.amplitude.to_latex() == "0" or contribution.scalar == "0":
                continue

            projected = MeasurementSymbolicTerm(
                contributions=[contribution],
                basis_bits=dict(term.basis_bits),
                payloads=dict(term.payloads),
            )
            projected.basis_bits.pop(measured_row, None)
            projected.payloads.pop(measured_row, None)
            key = measurement_symbolic_term_key(projected)
            branch = grouped.setdefault(outcome, {})
            existing = branch.get(key)
            if existing is None:
                branch[key] = projected
                continue

            merged = False
            for existing_contribution in existing.contributions:
                if existing_contribution.scalar != contribution.scalar:
                    continue
                existing_contribution.amplitude = existing_contribution.amplitude.add(contribution.amplitude)
                merged = True
                break
            if not merged:
                existing.contributions.append(contribution)

            existing.contributions = [
                current
                for current in existing.contributions
                if current.amplitude.to_latex() != "0" and current.scalar != "0"
            ]

    projected_branches: dict[int, list[MeasurementSymbolicTerm]] = {}
    for outcome, branch_terms in grouped.items():
        projected_branches[outcome] = [
            branch_term
            for branch_term in branch_terms.values()
            if branch_term.contributions
        ]
    return projected_branches


def render_measurement_state_latex(
    terms: list[SymbolicTerm],
    row_order: list[int],
    measured_row: int,
    row_labels: list[str],
) -> str:
    if any(term.scalar != "1" for term in terms):
        projected_symbolic = project_measurement_terms_symbolic(terms, measured_row)
        pieces: list[str] = []

        for outcome in sorted(projected_symbolic):
            branch_terms = projected_symbolic[outcome]
            if not branch_terms:
                continue
            branch_terms = sorted(
                branch_terms,
                key=lambda term: (
                    tuple(sorted(term.basis_bits.items())),
                    tuple(sorted(term.payloads.items())),
                ),
            )
            branch_expr = " + ".join(render_measurement_symbolic_term(term, row_order) for term in branch_terms).replace("+ -", "- ")
            if len(branch_terms) > 1:
                branch_expr = rf"\left({branch_expr}\right)"

            probability_pieces: list[str] = []
            for branch_term in branch_terms:
                if len(branch_term.contributions) == 1:
                    contribution = branch_term.contributions[0]
                    probability_piece = render_measurement_probability_contribution(contribution.amplitude, contribution.scalar)
                else:
                    coefficient = " + ".join(
                        render_measurement_coefficient(contribution.amplitude, contribution.scalar)
                        for contribution in branch_term.contributions
                    ).replace("+ -", "- ")
                    probability_piece = rf"\left|{coefficient}\right|^2"
                if probability_piece != "0":
                    probability_pieces.append(probability_piece)

            if not probability_pieces:
                continue
            probability = " + ".join(probability_pieces).replace("+ -", "- ")
            label = rf"\Pr({row_reference(row_labels, measured_row, 'q')}={outcome})={probability}"
            pieces.append(rf"{branch_expr}, & {label}")

        if not pieces:
            raise ValueError(f"Measurement on row {measured_row} produced no valid outcome branches")
        return r"\left\{\begin{array}{ll}" + r" \\ ".join(pieces) + r"\end{array}\right."

    projected = project_measurement_terms_exact(terms, measured_row)
    pieces: list[str] = []

    for outcome in sorted(projected):
        branch_terms = projected[outcome]
        if not branch_terms:
            continue
        branch_terms = sorted(
            branch_terms,
            key=lambda term: (
                tuple(sorted(term.basis_bits.items())),
                tuple(sorted(term.payloads.items())),
                term.scalar,
            ),
        )
        branch_expr = " + ".join(render_measurement_term(term, row_order) for term in branch_terms).replace("+ -", "- ")
        if len(branch_terms) > 1:
            branch_expr = rf"\left({branch_expr}\right)"
        probability = sum((term.amplitude.probability() for term in branch_terms), start=Fraction(0, 1))
        label = rf"\Pr({row_reference(row_labels, measured_row, 'q')}={outcome})={render_fraction_latex(probability)}"
        pieces.append(rf"{branch_expr}, & {label}")

    if not pieces:
        raise ValueError(f"Measurement on row {measured_row} produced no valid outcome branches")
    return r"\left\{\begin{array}{ll}" + r" \\ ".join(pieces) + r"\end{array}\right."


@dataclass(frozen=True)
class LocalSignature:
    kind: str
    value: int | str
    amplitude: Amplitude = field(default_factory=Amplitude)
    scalar: str = "1"


def local_signature_sort_key(signature: LocalSignature) -> tuple[object, ...]:
    kind_order = 0 if signature.kind == "basis" else 1
    value = signature.value if signature.kind == "basis" else str(signature.value)
    return (
        kind_order,
        value,
        signature.scalar,
        signature.amplitude.sqrt2_power,
        signature.amplitude.real,
        signature.amplitude.imag,
    )


def residual_signature_sort_key(signature: tuple[LocalSignature, ...]) -> tuple[tuple[object, ...], ...]:
    return tuple(local_signature_sort_key(component) for component in signature)


def make_local_signature(term: SymbolicTerm, row: int) -> LocalSignature | None:
    factor = get_row_factor(term, row)
    if factor is None or term.local_weights is None:
        return None
    weight = term.local_weights.get(row)
    if weight is None:
        return None
    return LocalSignature(
        kind=factor[0],
        value=factor[1],
        amplitude=weight.amplitude,
        scalar=weight.scalar,
    )


def row_wire_suffix(row_labels: list[str], row: int) -> str | None:
    name = row_wire_name(row_labels, row)
    if name is not None:
        return rf"_{{{name}}}"
    return None


def render_local_signature_component(
    signature: LocalSignature,
    row: int,
    row_labels: list[str],
    *,
    include_basis_suffix: bool,
) -> str:
    if signature.kind == "basis":
        factor = rf"\ket{{{signature.value}}}"
        if include_basis_suffix:
            suffix = row_wire_suffix(row_labels, row)
            if suffix is not None:
                factor += suffix
    else:
        factor = wrap_tensor_factor(str(signature.value))
    return render_scalar_weighted_expression(signature.amplitude, signature.scalar, factor)


def render_row_product_expression(signatures: list[LocalSignature], row: int, row_labels: list[str]) -> str:
    ordered_signatures = sorted(signatures, key=local_signature_sort_key)
    basis_only = all(signature.kind == "basis" for signature in ordered_signatures)
    if len(ordered_signatures) == 1:
        return render_local_signature_component(
            ordered_signatures[0],
            row,
            row_labels,
            include_basis_suffix=basis_only,
        )

    pieces = [
        render_local_signature_component(signature, row, row_labels, include_basis_suffix=False)
        for signature in ordered_signatures
    ]
    expression = rf"\left({' + '.join(pieces).replace('+ -', '- ')}\right)"
    if basis_only:
        suffix = row_wire_suffix(row_labels, row)
        if suffix is not None:
            return expression + suffix
    return expression


def build_term_from_local_signatures(
    row_order: list[int],
    signatures: tuple[LocalSignature, ...],
) -> SymbolicTerm:
    if len(row_order) != len(signatures):
        raise ValueError("Row/signature arity mismatch while rebuilding a factorized symbolic term")

    basis_bits: dict[int, int] = {}
    payloads: dict[int, str] = {}
    local_weights: dict[int, LocalWeight] = {}
    for row, signature in zip(row_order, signatures):
        if signature.kind == "basis":
            basis_bits[row] = int(signature.value)
        else:
            payloads[row] = str(signature.value)
        local_weights[row] = LocalWeight(amplitude=signature.amplitude, scalar=signature.scalar)

    combined_weight = combine_local_weights(list(local_weights.values()))
    return SymbolicTerm(
        amplitude=combined_weight.amplitude,
        scalar=combined_weight.scalar,
        basis_bits=basis_bits,
        payloads=payloads,
        local_weights=local_weights,
    )


def render_factorized_product_state(
    terms: list[SymbolicTerm],
    row_order: list[int],
    row_labels: list[str],
) -> str | None:
    if not terms or any(term.local_weights is None for term in terms):
        return None

    active_rows = [row for row in row_order if any(row in term.basis_bits or row in term.payloads for term in terms)]
    if not active_rows:
        return None

    if len(active_rows) == 1:
        row = active_rows[0]
        signatures = {make_local_signature(term, row) for term in terms}
        if any(signature is None for signature in signatures):
            return None
        return render_row_product_expression([signature for signature in signatures if signature is not None], row, row_labels)

    for row in (active_rows[0], active_rows[-1]):
        remaining_rows = [candidate for candidate in active_rows if candidate != row]
        local_signatures: set[LocalSignature] = set()
        residual_signatures: set[tuple[LocalSignature, ...]] = set()
        pairings: set[tuple[LocalSignature, tuple[LocalSignature, ...]]] = set()

        for term in terms:
            local_signature = make_local_signature(term, row)
            if local_signature is None:
                break
            residual_signature_items: list[LocalSignature] = []
            for other_row in remaining_rows:
                residual_signature = make_local_signature(term, other_row)
                if residual_signature is None:
                    break
                residual_signature_items.append(residual_signature)
            else:
                residual_signature_tuple = tuple(residual_signature_items)
                local_signatures.add(local_signature)
                residual_signatures.add(residual_signature_tuple)
                pairings.add((local_signature, residual_signature_tuple))
                continue
            break
        else:
            if len(terms) != len(local_signatures) * len(residual_signatures):
                continue
            if any((local_signature, residual_signature) not in pairings for local_signature in local_signatures for residual_signature in residual_signatures):
                continue

            local_expression = render_row_product_expression(list(local_signatures), row, row_labels)
            if not remaining_rows:
                return local_expression
            local_tensor_expression = wrap_tensor_factor(local_expression, wrap_sums=True)

            reduced_terms = [
                build_term_from_local_signatures(remaining_rows, residual_signature)
                for residual_signature in sorted(residual_signatures, key=residual_signature_sort_key)
            ]
            remainder = render_state_latex(reduced_terms, remaining_rows, row_labels)
            if row == active_rows[0]:
                correlated = render_correlated_uniform_tensor([local_tensor_expression, remainder])
                if correlated is not None:
                    return correlated
                return rf"{local_tensor_expression} \otimes {remainder}"
            correlated = render_correlated_uniform_tensor([remainder, local_tensor_expression])
            if correlated is not None:
                return correlated
            return rf"{remainder} \otimes {local_tensor_expression}"

    return None


def render_term(term: SymbolicTerm, row_order: list[int]) -> str:
    factors: list[str] = []
    index = 0
    active_rows = [row for row in row_order if row in term.basis_bits or row in term.payloads]
    while index < len(active_rows):
        row = active_rows[index]
        if row in term.basis_bits:
            bits = [str(term.basis_bits[row])]
            index += 1
            while index < len(active_rows) and active_rows[index] in term.basis_bits:
                bits.append(str(term.basis_bits[active_rows[index]]))
                index += 1
            factors.append(rf"\ket{{{''.join(bits)}}}")
            continue
        factors.append(wrap_tensor_factor(term.payloads[row], wrap_sums=True))
        index += 1

    factor_body = render_correlated_uniform_tensor(factors) or r" \otimes ".join(factors)
    return render_scalar_weighted_expression(term.amplitude, term.scalar, factor_body)


def render_grouped_terms(
    basis_strings: list[str],
    payload_factors: list[str],
) -> str:
    nonempty_basis_strings = sorted(basis for basis in basis_strings if basis)
    basis_terms = [rf"\ket{{{basis}}}" for basis in nonempty_basis_strings]
    if len(basis_terms) == 1:
        basis_expr = basis_terms[0]
    elif basis_terms:
        basis_expr = f"({' + '.join(basis_terms)})"
    else:
        basis_expr = ""

    payload_expr = r" \otimes ".join(wrap_tensor_factor(factor, wrap_sums=True) for factor in payload_factors)
    if basis_expr and payload_expr:
        return f"{basis_expr} \\otimes {payload_expr}"
    if payload_expr:
        return payload_expr
    return basis_expr


def render_amplitude_weighted_expression(amplitude: Amplitude, expression: str) -> str:
    amplitude_text = amplitude.to_latex()
    if amplitude_text == "1":
        return expression
    if amplitude_text == "-1":
        return f"-{expression}"
    if amplitude_text.startswith("-"):
        return f"-{amplitude_text[1:]} {expression}"
    return f"{amplitude_text} {expression}"


def has_payload_before_basis_row(terms: list[SymbolicTerm], row_order: list[int]) -> bool:
    active_rows = [row for row in row_order if any(row in term.basis_bits or row in term.payloads for term in terms)]
    seen_payload = False
    for row in active_rows:
        if any(row in term.payloads for term in terms):
            seen_payload = True
            continue
        if seen_payload and any(row in term.basis_bits for term in terms):
            return True
    return False


def render_state_latex(terms: list[SymbolicTerm], row_order: list[int], row_labels: list[str]) -> str:
    factorized = render_factorized_product_state(terms, row_order, row_labels)
    if factorized is not None:
        return factorized

    if any(term.scalar != "1" for term in terms) or has_payload_before_basis_row(terms, row_order):
        pieces = [
            render_term(term, row_order)
            for term in sorted(
                terms,
                key=lambda current: (
                    tuple(sorted(current.basis_bits.items())),
                    tuple(sorted(current.payloads.items())),
                    current.scalar,
                    current.amplitude.sqrt2_power,
                    current.amplitude.real,
                    current.amplitude.imag,
                ),
            )
        ]
        return " + ".join(pieces).replace("+ -", "- ")

    basis_rows = [row for row in row_order if any(row in term.basis_bits for term in terms)]
    payload_rows = [row for row in row_order if any(row in term.payloads for term in terms)]

    common_amplitude = terms[0].amplitude if terms and all(term.amplitude == terms[0].amplitude for term in terms) else None
    grouped: dict[tuple[str, ...] | tuple[tuple[str, ...], Amplitude], list[str]] = {}

    for term in sorted(
        terms,
        key=lambda current: (
            tuple(sorted(current.basis_bits.items())),
            tuple(sorted(current.payloads.items())),
            current.amplitude.sqrt2_power,
            current.amplitude.real,
            current.amplitude.imag,
        ),
    ):
        payload_key = tuple(term.payloads[row] for row in payload_rows if row in term.payloads)
        basis_string = "".join(str(term.basis_bits[row]) for row in basis_rows if row in term.basis_bits)
        group_key: tuple[str, ...] | tuple[tuple[str, ...], Amplitude]
        if common_amplitude is None:
            group_key = (payload_key, term.amplitude)
        else:
            group_key = payload_key
        grouped.setdefault(group_key, []).append(basis_string)

    pieces: list[str] = []
    for group_key, basis_strings in grouped.items():
        if common_amplitude is None:
            payload_key, amplitude = group_key
        else:
            payload_key = group_key
            amplitude = common_amplitude
        group_expr = render_grouped_terms(basis_strings, list(payload_key))
        if common_amplitude is None:
            pieces.append(render_amplitude_weighted_expression(amplitude, group_expr))
        else:
            pieces.append(group_expr)

    state = " + ".join(pieces).replace("+ -", "- ")
    if common_amplitude is None:
        return state

    common_text = common_amplitude.to_latex()
    if common_text == "1":
        return state
    if len(pieces) > 1:
        return render_amplitude_weighted_expression(common_amplitude, f"({state})")
    return render_amplitude_weighted_expression(common_amplitude, state)


def render_initial_state_latex(
    row_labels: list[str],
    label_spans: dict[int, tuple[str, int]],
    temporary_rows: set[int],
) -> str:
    factors: list[str] = []
    consumed: set[int] = set()
    for row in range(len(row_labels)):
        if row in consumed or row in temporary_rows:
            continue
        span_entry = label_spans.get(row)
        label = span_entry[0] if span_entry is not None else row_labels[row]
        span = span_entry[1] if span_entry is not None else 1
        if not label.strip():
            label = r"\ket{0}"
            span = 1
        consumed.update(range(row, row + span))
        factors.append(label)
    if not factors:
        raise ValueError("No input rows were found")
    return r" \otimes ".join(factors)


def render_state_block(index: int, rendered_state: str) -> str:
    return "\n".join(
        [
            r"\[",
            rf"\ket{{\Psi_{{{index}}}}} = {rendered_state}",
            r"\]",
        ]
    )


def slice_heading_text(slice_number: int, step_number: int | None) -> str:
    if step_number is None:
        return rf"\paragraph{{Slice {slice_number}: }} "
    return rf"\paragraph{{Slice {slice_number}, step {step_number}: }} "


def validate_exact_measurement_probabilities_sum_to_one(projected: dict[tuple[tuple[int, int], ...], list[SymbolicTerm]]) -> None:
    if not projected:
        return
    if any(term.scalar != "1" for terms in projected.values() for term in terms):
        return
    total_probability = Fraction(0, 1)
    for terms in projected.values():
        total_probability += sum((term.amplitude.probability() for term in terms), start=Fraction(0, 1))
    if total_probability != Fraction(1, 1):
        raise ValueError(
            rf"Measurement probabilities do not sum to 1 exactly: {render_fraction_latex(total_probability)}"
        )


def slice_rows(slice_info: LogicalSlice) -> set[int]:
    rows: set[int] = set()
    if slice_info.target_row is not None:
        rows.update(range(slice_info.target_row, slice_info.target_row + slice_info.span))
    if slice_info.secondary_row is not None:
        rows.add(slice_info.secondary_row)
    return rows


def build_discursive_block(
    row_labels: list[str],
    label_spans: dict[int, tuple[str, int]],
    logical_slices: list[LogicalSlice],
) -> str:
    temporary_rows = {slice_info.target_row for slice_info in logical_slices if slice_info.kind in {"and_compute", "and_uncompute"} and slice_info.target_row is not None}
    terms = make_initial_terms(row_labels, label_spans, temporary_rows)
    branches = [OutcomeBranch(terms=terms)]
    initial_rows = {
        row
        for term in terms
        for row in set(term.basis_bits) | set(term.payloads)
    }
    all_rows = sorted(initial_rows | temporary_rows | {row for slice_info in logical_slices for row in slice_rows(slice_info)})

    blocks = [render_state_block(0, render_initial_state_latex(row_labels, label_spans, temporary_rows))]
    slice_runs: list[tuple[int, int]] = []
    run_start = 0
    while run_start < len(logical_slices):
        run_end = run_start + 1
        run_source_columns = tuple(logical_slices[run_start].source_columns)
        while run_end < len(logical_slices) and tuple(logical_slices[run_end].source_columns) == run_source_columns:
            run_end += 1
        slice_runs.append((run_start, run_end))
        run_start = run_end

    state_index = 1
    for slice_number, (run_start, run_end) in enumerate(slice_runs, start=1):
        run_length = run_end - run_start
        for run_offset, logical_index in enumerate(range(run_start, run_end), start=1):
            slice_info = logical_slices[logical_index]
            if slice_info.kind == "measure":
                assert slice_info.target_row is not None
                measured_rows = list(range(slice_info.target_row, slice_info.target_row + slice_info.span))
                next_branches: list[OutcomeBranch] = []
                for branch in branches:
                    measured_terms = branch.terms
                    classical_controls = dict(branch.outcomes)
                    if slice_info.controls:
                        matching_terms = [
                            term
                            for term in branch.terms
                            if controls_match(term, slice_info.controls, classical_controls)
                        ]
                        if matching_terms and len(matching_terms) != len(branch.terms):
                            raise ValueError(
                                "Controlled measurement is only supported when each branch has a definite control bitstring"
                            )
                        if not matching_terms:
                            next_branches.append(branch)
                            continue
                        measured_terms = matching_terms

                    projected = project_measurement_terms(measured_terms, measured_rows)
                    if not projected:
                        raise ValueError(f"Measurement on rows {measured_rows} produced no valid outcome branches")
                    validate_exact_measurement_probabilities_sum_to_one(projected)
                    for outcomes, projected_terms in projected.items():
                        next_branches.append(OutcomeBranch(outcomes=branch.outcomes + outcomes, terms=projected_terms))
                branches = merge_outcome_branches(next_branches)
            else:
                branches = merge_outcome_branches(
                    [
                        OutcomeBranch(
                            outcomes=branch.outcomes,
                            terms=evolve_terms(branch.terms, slice_info, row_labels, dict(branch.outcomes)),
                        )
                        for branch in branches
                    ]
                )
            active_rows = [
                row
                for row in all_rows
                if any(
                    row in term.basis_bits or row in term.payloads
                    for branch in branches
                    for term in branch.terms
                )
            ]
            rendered_state = render_branches_state_latex(
                branches,
                active_rows,
                row_labels,
                collapse_identical_branches=slice_info.kind != "measure",
            )
            step_number = run_offset if run_length > 1 else None
            blocks.append(f"{slice_heading_text(slice_number, step_number)}{slice_info.description}")
            blocks.append(render_state_block(state_index, rendered_state))
            state_index += 1
    return "\n\n".join(blocks) + "\n"


def generate_symbolic_latex(source_text: str, env_index: int = 0) -> str:
    row_labels, label_spans, grid = extract_environment_grid(source_text, env_index)
    logical_slices = build_logical_slices(row_labels, grid)
    return build_discursive_block(row_labels, label_spans, logical_slices)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Return LaTeX code for slice-by-slice symbolic evolution of supported Quantikz circuits."
    )
    parser.add_argument("input", help="Path to a TeX file containing a quantikz environment")
    parser.add_argument("--env-index", type=int, default=0, help="Zero-based quantikz environment index")
    args = parser.parse_args()

    input_path = pathlib.Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    try:
        source_text = input_path.read_text(encoding="utf-8")
        sys.stdout.write(generate_symbolic_latex(source_text, args.env_index))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
