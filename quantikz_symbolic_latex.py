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
    find_quantikz_environments,
    parse_command_sequence,
    parse_connector,
    parse_label_command,
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
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)

    def clone(self) -> "SymbolicTerm":
        return SymbolicTerm(
            amplitude=self.amplitude,
            basis_bits=dict(self.basis_bits),
            payloads=dict(self.payloads),
        )


@dataclass
class LogicalSlice:
    kind: str
    controls: list[tuple[int, int]]
    target_row: int | None
    secondary_row: int | None
    label: str
    description: str
    source_columns: list[int]


@dataclass
class MeasurementRenderedTerm:
    amplitude: Amplitude
    basis_bits: dict[int, int] = field(default_factory=dict)
    payloads: dict[int, str] = field(default_factory=dict)


def extract_environment_grid(source_text: str, env_index: int) -> tuple[list[str], list[list[str]]]:
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
    row_cells: list[list[str]] = []
    for row_index, raw_row in enumerate(raw_rows):
        cells = [cell.strip() for cell in split_top_level(raw_row, "&")]
        left_label, first_remainder = parse_label_command(cells[0] if cells else "", "lstick")
        if left_label is not None:
            row_labels[row_index] = left_label.label
            cells[0] = first_remainder
        _, last_remainder = parse_label_command(cells[-1] if cells else "", "rstick")
        if cells:
            cells[-1] = last_remainder
        row_cells.append(cells)

    column_count = max(len(cells) for cells in row_cells)
    normalized_rows = [cells + [""] * (column_count - len(cells)) for cells in row_cells]
    return row_labels, normalized_rows


def is_noop_command(command: ParsedCommand) -> bool:
    return command.name in {"qw", "wireoverride", "raw"}


def classify_column(row_cells: list[str]) -> dict[str, object]:
    controls: list[tuple[int, int]] = []
    control_targets: list[tuple[int, int, int]] = []
    gates: list[tuple[int, str]] = []
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
                gates.append((row, command.args[0] if command.args else "?"))
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


def ancilla_description(action: str, row: int) -> str:
    return rf"{action} ancilla $a_{{{row}}}$"


def qubit_description(action: str, row: int) -> str:
    return rf"{action} $q_{{{row}}}$"


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
                        label=rf"\text{{compute AND into ancilla }}a_{{{compute_row}}}",
                        description=ancilla_description("compute AND into", compute_row),
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
                            label=(
                                rf"\text{{uncompute AND and remove ancilla }}a_{{{connector_corner_target}}}"
                                if is_uncompute
                                else rf"\text{{compute AND into ancilla }}a_{{{connector_corner_target}}}"
                            ),
                            description=(
                                ancilla_description("uncompute AND and remove", connector_corner_target)
                                if is_uncompute
                                else ancilla_description("compute AND into", connector_corner_target)
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
                            label=rf"\text{{uncompute AND and remove ancilla }}a_{{{uncompute_row}}}",
                            description=ancilla_description("uncompute AND and remove", uncompute_row),
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
                        label="SWAP",
                        description=(
                            rf"controlled swap between $q_{{{top_row}}}$ and $q_{{{bottom_row}}}$"
                            if controls
                            else rf"swap $q_{{{top_row}}}$ and $q_{{{bottom_row}}}$"
                        ),
                        source_columns=[index],
                    ),
                )
            )
        unused_swap_targets = sorted(set(current["swap_targets"]) - used_swap_targets)
        if unused_swap_targets:
            raise ValueError(f"Swap target marker at row {unused_swap_targets[0]} is missing a matching \\swap")

        for gate_row, gate_label in current["gates"]:
            controls = sorted(
                (row, expected)
                for row, target_row, expected in current["control_targets"]
                if target_row == gate_row
            )
            column_slices.append(
                (
                    gate_row,
                    1,
                    LogicalSlice(
                        kind="controlled_gate" if controls else "gate",
                        controls=controls,
                        target_row=gate_row,
                        secondary_row=None,
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
                        label="X",
                        description=rf"controlled $X$ on $a_{{{target_row}}}$",
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
                        label="measure",
                        description=qubit_description("measure", measured_row),
                        source_columns=[index],
                    ),
                )
            )

        logical_slices.extend(slice_info for _, _, slice_info in sorted(column_slices, key=lambda item: (item[1], item[0])))
        index += 2 if skip_next else 1

    return logical_slices


def parse_label_kind(label: str) -> tuple[str, str]:
    normalized = label.strip()
    ket_match = re.match(r"^\\ket\{([^{}]+)\}", normalized)
    if not ket_match:
        return "payload", normalized or r"\ket{\psi}"
    ket_value = ket_match.group(1)
    if ket_value in {"0", "1", "+", "-"}:
        return ket_value, normalized
    return "payload", normalized


def make_initial_terms(row_labels: list[str], temporary_rows: set[int]) -> list[SymbolicTerm]:
    active_rows = [row for row, label in enumerate(row_labels) if label.strip() and row not in temporary_rows]
    terms = [SymbolicTerm(amplitude=Amplitude())]

    for row in active_rows:
        label = row_labels[row]
        kind, payload = parse_label_kind(label)
        next_terms: list[SymbolicTerm] = []
        for term in terms:
            if kind == "0":
                updated = term.clone()
                updated.basis_bits[row] = 0
                next_terms.append(updated)
            elif kind == "1":
                updated = term.clone()
                updated.basis_bits[row] = 1
                next_terms.append(updated)
            elif kind == "+":
                zero_term = term.clone()
                zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
                zero_term.basis_bits[row] = 0
                next_terms.append(zero_term)

                one_term = term.clone()
                one_term.amplitude = one_term.amplitude.multiply(sqrt2_power=1)
                one_term.basis_bits[row] = 1
                next_terms.append(one_term)
            elif kind == "-":
                zero_term = term.clone()
                zero_term.amplitude = zero_term.amplitude.multiply(sqrt2_power=1)
                zero_term.basis_bits[row] = 0
                next_terms.append(zero_term)

                one_term = term.clone()
                one_term.amplitude = one_term.amplitude.multiply(sign=-1, sqrt2_power=1)
                one_term.basis_bits[row] = 1
                next_terms.append(one_term)
            else:
                updated = term.clone()
                updated.payloads[row] = payload
                next_terms.append(updated)
        terms = next_terms

    return terms


def is_named_single_qubit_gate(label: str) -> bool:
    return label.strip() in {"H", "S", "X", "Y", "Z"}


def merge_symbolic_terms(terms: list[SymbolicTerm]) -> list[SymbolicTerm]:
    grouped: dict[tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]], SymbolicTerm] = {}

    for term in terms:
        key = (
            tuple(sorted(term.basis_bits.items())),
            tuple(sorted(term.payloads.items())),
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


def apply_named_gate_to_basis_term(term: SymbolicTerm, row: int, label: str) -> list[SymbolicTerm] | None:
    if row not in term.basis_bits:
        return None

    bit = term.basis_bits[row]
    normalized_label = label.strip()

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
    else:
        return None

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
                if current_value is None:
                    raise ValueError(f"Controlled X target row {slice_info.target_row} is not in the computational basis")
                updated.basis_bits[slice_info.target_row] = 1 - current_value
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
            if is_named_single_qubit_gate(slice_info.label):
                evolved_terms = apply_named_gate_to_basis_term(updated, slice_info.target_row, slice_info.label)
                if evolved_terms is not None:
                    next_terms.extend(evolved_terms)
                    continue
            current = updated.payloads.get(slice_info.target_row)
            if current is None and slice_info.target_row in updated.basis_bits:
                current = rf"\ket{{{updated.basis_bits[slice_info.target_row]}}}"
                updated.basis_bits.pop(slice_info.target_row)
            if current is None:
                raise ValueError(f"Gate target row {slice_info.target_row} has no symbolic factor to act on")
            updated.payloads[slice_info.target_row] = apply_operator(slice_info.label, current)
        elif slice_info.kind == "controlled_gate":
            assert slice_info.target_row is not None
            if all(updated.basis_bits.get(row) == expected for row, expected in slice_info.controls):
                if is_named_single_qubit_gate(slice_info.label):
                    evolved_terms = apply_named_gate_to_basis_term(updated, slice_info.target_row, slice_info.label)
                    if evolved_terms is not None:
                        next_terms.extend(evolved_terms)
                        continue
                current = updated.payloads.get(slice_info.target_row)
                if current is None and slice_info.target_row in updated.basis_bits:
                    current = rf"\ket{{{updated.basis_bits[slice_info.target_row]}}}"
                    updated.basis_bits.pop(slice_info.target_row)
                if current is None:
                    raise ValueError(f"Controlled gate target row {slice_info.target_row} has no symbolic factor to act on")
                updated.payloads[slice_info.target_row] = apply_operator(slice_info.label, current)
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
        f"Measurement on row {row} is only supported for computational-basis states and simple H/S/X/Y/Z-applied basis states"
    )


def measurement_term_key(term: MeasurementRenderedTerm) -> tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]]:
    return (
        tuple(sorted(term.basis_bits.items())),
        tuple(sorted(term.payloads.items())),
    )


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
        factors.append(term.payloads[row])
        index += 1

    factor_body = r" \otimes ".join(factors)
    return render_amplitude_weighted_expression(term.amplitude, factor_body)


def project_measurement_terms(
    terms: list[SymbolicTerm],
    measured_row: int,
) -> dict[int, list[MeasurementRenderedTerm]]:
    grouped: dict[int, dict[tuple[tuple[tuple[int, int], ...], tuple[tuple[int, str], ...]], MeasurementRenderedTerm]] = {}

    for term in terms:
        for outcome, factor_amplitude in measurement_factor_options(term, measured_row):
            projected = MeasurementRenderedTerm(
                amplitude=term.amplitude.times(factor_amplitude),
                basis_bits=dict(term.basis_bits),
                payloads=dict(term.payloads),
            )
            projected.basis_bits[measured_row] = outcome
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


def render_measurement_state_latex(terms: list[SymbolicTerm], row_order: list[int], measured_row: int) -> str:
    projected = project_measurement_terms(terms, measured_row)
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
            ),
        )
        branch_expr = " + ".join(render_measurement_term(term, row_order) for term in branch_terms).replace("+ -", "- ")
        if len(branch_terms) > 1:
            branch_expr = rf"\left({branch_expr}\right)"
        probability = sum((term.amplitude.probability() for term in branch_terms), start=Fraction(0, 1))
        label = rf"\Pr(q_{{{measured_row}}}={outcome})={render_fraction_latex(probability)}"
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
        factors.append(term.payloads[row])
        index += 1

    factor_body = r" \otimes ".join(factors)
    return render_amplitude_weighted_expression(term.amplitude, factor_body)


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

    payload_expr = r" \otimes ".join(payload_factors)
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


def render_state_latex(terms: list[SymbolicTerm], row_order: list[int]) -> str:
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


def render_initial_state_latex(row_labels: list[str], temporary_rows: set[int]) -> str:
    factors = [label for row, label in enumerate(row_labels) if label.strip() and row not in temporary_rows]
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


def build_discursive_block(row_labels: list[str], logical_slices: list[LogicalSlice]) -> str:
    temporary_rows = {slice_info.target_row for slice_info in logical_slices if slice_info.kind in {"and_compute", "and_uncompute"} and slice_info.target_row is not None}
    terms = make_initial_terms(row_labels, temporary_rows)
    persistent_rows = [row for row, label in enumerate(row_labels) if label.strip() and row not in temporary_rows]
    all_rows = sorted({row for row in persistent_rows} | temporary_rows | {slice_info.target_row for slice_info in logical_slices if slice_info.target_row is not None})

    blocks = [render_state_block(0, render_initial_state_latex(row_labels, temporary_rows))]
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
                rendered_state = render_measurement_state_latex(terms, active_rows, slice_info.target_row)
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
    row_labels, grid = extract_environment_grid(source_text, env_index)
    logical_slices = build_logical_slices(row_labels, grid)
    return build_discursive_block(row_labels, logical_slices)


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
