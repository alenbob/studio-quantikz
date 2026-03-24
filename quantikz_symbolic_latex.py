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


@dataclass
class SymbolicTerm:
    amplitude: Amplitude
    scalar: str = "1"
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)

    def clone(self) -> "SymbolicTerm":
        return SymbolicTerm(
            amplitude=self.amplitude,
            scalar=self.scalar,
            basis_bits=dict(self.basis_bits),
            payloads=dict(self.payloads),
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
    meters: list[int] = []
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
                meters.append(row)
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


def row_reference(row_labels: list[str], row: int, fallback_prefix: str) -> str:
    if 0 <= row < len(row_labels):
        named_reference = extract_trailing_subscript(row_labels[row])
        if named_reference is not None:
            return named_reference
    return rf"{fallback_prefix}_{{{row}}}"


def ancilla_description(action: str, row_labels: list[str], row: int) -> str:
    return rf"{action} ancilla ${row_reference(row_labels, row, 'a')}$"


def qubit_description(action: str, row_labels: list[str], row: int) -> str:
    return rf"{action} ${row_reference(row_labels, row, 'q')}$"


def controls_for_gate_span(column: dict[str, object], gate_row: int, gate_span: int) -> list[tuple[int, int]]:
    gate_rows = set(range(gate_row, gate_row + gate_span))
    matched = {
        (row, expected)
        for row, target_row, expected in column["control_targets"]
        if target_row in gate_rows
    }
    standalone_controls = list(column["controls"])
    connectors = column["connectors_to_rows"]
    for control_row, expected in standalone_controls:
        if gate_rows & connectors.get(control_row, set()):
            matched.add((control_row, expected))
            continue
        for source_row, endpoints in connectors.items():
            if source_row in gate_rows and control_row in endpoints:
                matched.add((control_row, expected))
                break
    return sorted(matched)


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
            controls = sorted(
                (row, expected)
                for row, target_row, expected in current["control_targets"]
                if top_row <= target_row <= bottom_row
            )
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
                    ),
                )
            )

        for target_row in current["targets"]:
            controls = sorted(
                (row, expected)
                for row, target_target_row, expected in current["control_targets"]
                if target_target_row == target_row
            )
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

        for measured_row in current["meters"]:
            column_slices.append(
                (
                    measured_row,
                    2,
                    LogicalSlice(
                        kind="measure",
                        controls=[],
                        target_row=measured_row,
                        secondary_row=None,
                        span=1,
                        label="measure",
                        description=qubit_description("measure", row_labels, measured_row),
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
        return [updated]
    if symbol == "1":
        updated = term.clone()
        updated.basis_bits[row] = 1
        return [updated]
    if symbol == "+":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sqrt2_power=1)
        one_term.basis_bits[row] = 1
        return [zero_term, one_term]
    if symbol == "-":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sign=-1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        return [zero_term, one_term]
    if symbol == "i":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(i_power=1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        return [zero_term, one_term]
    if symbol == "-i":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(i_power=-1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
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
            continue

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
                next_terms.append(updated)
        terms = next_terms

    return terms


def is_named_single_qubit_gate(label: str) -> bool:
    normalized = canonical_gate_label(label)
    return normalized in {"H", "S", "T", "Tdg", "X", "Y", "Z"} or parse_pauli_rotation_label(normalized) is not None


def parse_pauli_rotation_label(label: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"R([XYZ])\((.*)\)", label)
    if match is None:
        return None
    return match.group(1), match.group(2).strip()


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
    stripped = scalar.strip()
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
    left_stripped = left.strip()
    right_stripped = right.strip()
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

    left_sqrt = extract_sqrt_argument(left_stripped)
    right_sqrt = extract_sqrt_argument(right_stripped)
    if left_sqrt is not None and right_sqrt is not None:
        return rf"\sqrt{{{multiply_radicands(left_sqrt, right_sqrt)}}}"

    return f"{left_stripped} {right_stripped}"


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
        return rf"\sqrt{{1-{strip_outer_grouping(sqrt_argument)}}}"

    base = strip_outer_grouping(argument)
    if re.fullmatch(r"[A-Za-z0-9]+", base) or re.fullmatch(r"\\[A-Za-z]+", base):
        squared = rf"{base}^2"
    else:
        squared = rf"({base})^2"
    return rf"\sqrt{{1-{squared}}}"


def simplify_half_angle_trig(angle: str, trig_function: str) -> str | None:
    parsed = parse_double_inverse_trig_angle(angle)
    if parsed is None:
        return None

    function_name, argument = parsed
    if function_name == r"\arccos":
        if trig_function == "cos":
            return argument
        return complementary_half_angle_factor(argument)
    if trig_function == "sin":
        return argument
    return complementary_half_angle_factor(argument)


def half_angle_trig_factor(angle: str, trig_function: str) -> str:
    simplified = simplify_half_angle_trig(angle, trig_function)
    if simplified is not None:
        return simplified
    return rf"\{trig_function}\left({render_half_angle(angle)}\right)"


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

    if rotation is not None:
        axis, angle = rotation
        branches: list[SymbolicTerm] = []
        for updated_bit, amplitude_factor, scalar_factor in pauli_rotation_basis_branches(axis, angle, bit):
            updated = term.clone()
            updated.amplitude = updated.amplitude.times(amplitude_factor)
            updated.scalar = multiply_scalar_factors(updated.scalar, scalar_factor)
            updated.basis_bits[row] = updated_bit
            if updated.amplitude.to_latex() != "0" and updated.scalar != "0":
                branches.append(updated)
        return branches

    if normalized_label == "H":
        zero_term = term.clone()
        zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
        zero_term.basis_bits[row] = 0

        one_term = term.clone()
        one_term.amplitude = one_term.amplitude.multiply(sign=-1 if bit == 1 else 1, sqrt2_power=1)
        one_term.basis_bits[row] = 1
        return [zero_term, one_term]

    updated = term.clone()
    if normalized_label == "X":
        updated.basis_bits[row] = 1 - bit
    elif normalized_label == "Y":
        updated.basis_bits[row] = 1 - bit
        updated.amplitude = updated.amplitude.multiply(sign=-1 if bit == 1 else 1, i_power=1)
    elif normalized_label == "Z":
        if bit == 1:
            updated.amplitude = updated.amplitude.multiply(sign=-1)
    elif normalized_label == "S":
        if bit == 1:
            updated.amplitude = updated.amplitude.multiply(i_power=1)
    elif normalized_label == "T":
        if bit == 1:
            updated.amplitude = updated.amplitude.times(Amplitude(real=1, imag=1, sqrt2_power=1))
    elif normalized_label == "Tdg":
        if bit == 1:
            updated.amplitude = updated.amplitude.times(Amplitude(real=1, imag=-1, sqrt2_power=1))
    else:
        return None

    return [updated]


def apply_gate_to_term(term: SymbolicTerm, target_row: int, span: int, label: str) -> list[SymbolicTerm]:
    components = decompose_tensor_product_gate_label(label, span)
    if components is not None:
        evolved_terms = [term.clone()]
        for row, component in zip(range(target_row, target_row + span), components):
            next_terms: list[SymbolicTerm] = []
            for evolved_term in evolved_terms:
                if component == "I":
                    next_terms.append(evolved_term)
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

    updated = term.clone()
    factors: list[str] = []
    for row in range(target_row, target_row + span):
        current = row_factor_expression(updated, row)
        if current is None:
            raise ValueError(f"Gate target row {row} has no symbolic factor to act on")
        factors.append(current)
        updated.basis_bits.pop(row, None)
        updated.payloads.pop(row, None)

    factor_body = r" \otimes ".join(factors)
    if span > 1:
        factor_body = rf"\left({factor_body}\right)"
    updated.payloads[target_row] = apply_operator(label, factor_body)
    return [updated]


def evolve_terms(terms: list[SymbolicTerm], slice_info: LogicalSlice) -> list[SymbolicTerm]:
    next_terms: list[SymbolicTerm] = []
    for term in terms:
        updated = term.clone()
        if slice_info.kind == "and_compute":
            assert slice_info.target_row is not None
            try:
                control_value = int(all(updated.basis_bits[row] == expected for row, expected in slice_info.controls))
            except KeyError as exc:
                raise ValueError(f"AND control row {exc.args[0]} is not in the computational basis") from exc
            updated.basis_bits[slice_info.target_row] = control_value
        elif slice_info.kind == "and_uncompute":
            assert slice_info.target_row is not None
            updated.basis_bits.pop(slice_info.target_row, None)
        elif slice_info.kind == "controlled_x":
            assert slice_info.target_row is not None
            if all(updated.basis_bits.get(row) == expected for row, expected in slice_info.controls):
                current_value = updated.basis_bits.get(slice_info.target_row)
                if current_value is not None:
                    updated.basis_bits[slice_info.target_row] = 1 - current_value
                else:
                    current = row_factor_expression(updated, slice_info.target_row)
                    if current is None:
                        raise ValueError(f"Controlled X target row {slice_info.target_row} has no symbolic factor to act on")
                    updated.payloads[slice_info.target_row] = apply_operator("X", current)
        elif slice_info.kind == "swap":
            assert slice_info.target_row is not None
            assert slice_info.secondary_row is not None
            if all(updated.basis_bits.get(row) == expected for row, expected in slice_info.controls):
                left_factor = get_row_factor(updated, slice_info.target_row)
                right_factor = get_row_factor(updated, slice_info.secondary_row)
                set_row_factor(updated, slice_info.target_row, right_factor)
                set_row_factor(updated, slice_info.secondary_row, left_factor)
        elif slice_info.kind == "gate":
            assert slice_info.target_row is not None
            next_terms.extend(apply_gate_to_term(updated, slice_info.target_row, slice_info.span, slice_info.label))
            continue
        elif slice_info.kind == "controlled_gate":
            assert slice_info.target_row is not None
            if all(updated.basis_bits.get(row) == expected for row, expected in slice_info.controls):
                next_terms.extend(apply_gate_to_term(updated, slice_info.target_row, slice_info.span, slice_info.label))
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
    scalar_text = scalar.strip()
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


def measurement_term_key(term: MeasurementRenderedTerm) -> tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...], str]:
    return (
        tuple(sorted(term.basis_bits.items())),
        tuple(sorted(term.payloads.items())),
        term.scalar,
    )


def render_scalar_weighted_expression(amplitude: Amplitude, scalar: str, expression: str) -> str:
    scalar_text = scalar.strip()
    effective_amplitude = amplitude
    if scalar_text.startswith("-"):
        scalar_text = scalar_text[1:].strip()
        effective_amplitude = effective_amplitude.multiply(sign=-1)

    amplitude_text = effective_amplitude.to_latex()
    if scalar_text == "1":
        if amplitude_text == "1":
            return expression
        if amplitude_text == "-1":
            return f"-{expression}"
        return f"{amplitude_text} {expression}"

    if amplitude_text == "1":
        return f"{scalar_text} {expression}"
    if amplitude_text == "-1":
        return f"-{scalar_text} {expression}"
    return f"{amplitude_text} {scalar_text} {expression}"


def wrap_tensor_factor(factor: str) -> str:
    stripped = factor.strip()
    if " + " in stripped or " - " in stripped[1:]:
        return rf"\left({stripped}\right)"
    return stripped


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
        factors.append(wrap_tensor_factor(term.payloads[row]))
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
        factors.append(wrap_tensor_factor(term.payloads[row]))
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
        factors.append(wrap_tensor_factor(term.payloads[row]))
        index += 1

    factor_body = r" \otimes ".join(factors)
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

    payload_expr = r" \otimes ".join(wrap_tensor_factor(factor) for factor in payload_factors)
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


def render_state_latex(terms: list[SymbolicTerm], row_order: list[int]) -> str:
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
            continue
        consumed.update(range(row, row + span))
        factors.append(label)
    if not factors:
        raise ValueError("No labeled input rows were found")
    return r" \otimes ".join(factors)


def render_state_block(index: int, rendered_state: str) -> str:
    return "\n".join(
        [
            r"\begin{equation*}",
            r"\begin{aligned}",
            rf"\ket{{\Psi_{{{index}}}}} &= {rendered_state}",
            r"\end{aligned}",
            r"\end{equation*}",
        ]
    )


def slice_heading_text(slice_number: int, step_number: int | None) -> str:
    if step_number is None:
        return rf"\textbf{{Slice {slice_number}: }}"
    return rf"\textbf{{Slice {slice_number}, step {step_number}: }}"


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
                if logical_index != len(logical_slices) - 1:
                    raise ValueError("Measurement is only supported as the final logical slice in symbolic LaTeX output")
                assert slice_info.target_row is not None
                active_rows = [row for row in all_rows if any(row in term.basis_bits or row in term.payloads for term in terms)]
                rendered_state = render_measurement_state_latex(terms, active_rows, slice_info.target_row, row_labels)
            else:
                terms = evolve_terms(terms, slice_info)
                active_rows = [row for row in all_rows if any(row in term.basis_bits or row in term.payloads for term in terms)]
                rendered_state = render_state_latex(terms, active_rows)
            step_number = run_offset if run_length > 1 else None
            blocks.append(rf"\noindent{slice_heading_text(slice_number, step_number)} {slice_info.description}\par")
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
