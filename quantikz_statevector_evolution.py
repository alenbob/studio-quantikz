#!/usr/bin/env python3
"""Convert Quantikz circuits into slice-by-slice symbolic state evolution."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction


@dataclass
class QuantikzEnvironment:
    index: int
    options: str
    body: str
    start: int
    end: int
    title: str | None = None

    @property
    def source(self) -> str:
        return f"\\begin{{quantikz}}{self.options}{self.body}\\end{{quantikz}}"


@dataclass
class ParsedCommand:
    name: str
    options: list[str]
    args: list[str]


@dataclass
class LabelCommand:
    label: str
    span: int


@dataclass
class ControlRef:
    row: int
    endpoint: int | None
    state: str
    source: str


@dataclass
class GateRef:
    row: int
    span: int
    label: str


@dataclass
class MeterRef:
    row: int
    span: int


@dataclass
class TargetRef:
    row: int
    endpoint: int | None


@dataclass
class SwapRef:
    row: int
    endpoint: int | None


@dataclass
class ConnectorRef:
    row: int
    endpoint: int
    wire_type: str
    source: str


@dataclass
class ExecutableOp:
    kind: str
    display: str
    sort_key: int
    qubit: int | None = None
    label: str | None = None
    controls: list[tuple[int, str]] = field(default_factory=list)
    targets: list[int] = field(default_factory=list)
    qubits: list[int] = field(default_factory=list)


@dataclass
class SliceEvolution:
    index: int
    labels: list[str]
    operations: list[str]
    state: str
    expanded_state: str | None = None
    measurement_outcomes: list["MeasurementOutcome"] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class CircuitEvolution:
    index: int
    title: str | None
    rows: int
    columns: int
    initial_state: str
    slices: list[SliceEvolution]
    source: str


@dataclass
class MeasurementOutcome:
    outcome: str
    measured_qubits: list[int]
    remaining_qubits: list[int]
    probability: str
    remaining_state: str | None


ENVIRONMENT_PATTERN = re.compile(r"\\begin\{quantikz\}(\[[^\]]*\])?(.*?)\\end\{quantikz\}", re.S)
SUBSECTION_PATTERN = re.compile(r"\\subsection\*\{(.*?)\}", re.S)
KNOWN_NOOPS = {
    "color",
    "control",
    "gategroup",
    "ghost",
    "lstick",
    "octrl",
    "ocontrol",
    "qw",
    "qwbundle",
    "rstick",
    "setwiretype",
    "slice",
    "wireoverride",
}


def find_quantikz_environments(source_text: str) -> list[QuantikzEnvironment]:
    titles = [(match.start(), collapse_whitespace(match.group(1))) for match in SUBSECTION_PATTERN.finditer(source_text)]
    environments: list[QuantikzEnvironment] = []
    for index, match in enumerate(ENVIRONMENT_PATTERN.finditer(source_text)):
        title = None
        for title_start, candidate in titles:
            if title_start > match.start():
                break
            title = candidate
        environments.append(
            QuantikzEnvironment(
                index=index,
                options=match.group(1) or "",
                body=match.group(2),
                start=match.start(),
                end=match.end(),
                title=title,
            )
        )
    return environments


def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())


def is_escaped_at(value: str, index: int) -> bool:
    backslash_count = 0
    cursor = index - 1
    while cursor >= 0 and value[cursor] == "\\":
        backslash_count += 1
        cursor -= 1
    return backslash_count % 2 == 1


def strip_comments(value: str) -> str:
    lines: list[str] = []
    for line in value.splitlines():
        for index, char in enumerate(line):
            if char == "%" and not is_escaped_at(line, index):
                line = line[:index]
                break
        lines.append(line)
    return "\n".join(lines)


def split_top_level(source: str, delimiter: str) -> list[str]:
    parts: list[str] = []
    brace_depth = 0
    bracket_depth = 0
    start = 0
    index = 0
    while index < len(source):
        char = source[index]
        if not is_escaped_at(source, index):
            if char == "{":
                brace_depth += 1
            elif char == "}":
                brace_depth = max(0, brace_depth - 1)
            elif char == "[" and brace_depth == 0:
                bracket_depth += 1
            elif char == "]" and brace_depth == 0:
                bracket_depth = max(0, bracket_depth - 1)

        if brace_depth == 0 and bracket_depth == 0:
            if delimiter == "&" and char == "&" and not is_escaped_at(source, index):
                parts.append(source[start:index])
                start = index + 1
            elif (
                delimiter == "\\\\"
                and char == "\\"
                and index + 1 < len(source)
                and source[index + 1] == "\\"
                and not is_escaped_at(source, index)
            ):
                parts.append(source[start:index])
                start = index + 2
                index += 1
        index += 1

    parts.append(source[start:])
    return parts


def split_options(option_text: str) -> list[str]:
    parts: list[str] = []
    brace_depth = 0
    bracket_depth = 0
    start = 0
    for index, char in enumerate(option_text):
        if not is_escaped_at(option_text, index):
            if char == "{":
                brace_depth += 1
            elif char == "}":
                brace_depth = max(0, brace_depth - 1)
            elif char == "[" and brace_depth == 0:
                bracket_depth += 1
            elif char == "]" and brace_depth == 0:
                bracket_depth = max(0, bracket_depth - 1)

        if brace_depth == 0 and bracket_depth == 0 and char == "," and not is_escaped_at(option_text, index):
            parts.append(option_text[start:index].strip())
            start = index + 1

    parts.append(option_text[start:].strip())
    return [part for part in parts if part]


def parse_group(source: str, start: int, open_char: str, close_char: str) -> tuple[str, int]:
    if source[start] != open_char:
        raise ValueError(f"Expected {open_char!r} at position {start}")

    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if is_escaped_at(source, index):
            continue
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return source[start + 1:index], index + 1

    raise ValueError(f"Unterminated group starting at {start}")


def skip_whitespace(source: str, start: int) -> int:
    index = start
    while index < len(source) and source[index].isspace():
        index += 1
    return index


def parse_command_sequence(source: str) -> list[ParsedCommand]:
    commands: list[ParsedCommand] = []
    index = 0
    while index < len(source):
        index = skip_whitespace(source, index)
        if index >= len(source):
            break
        if source[index] != "\\":
            raw = source[index:].strip()
            if raw:
                commands.append(ParsedCommand(name="raw", options=[], args=[raw]))
            break

        cursor = index + 1
        while cursor < len(source) and source[cursor].isalpha():
            cursor += 1
        name = source[index + 1:cursor]
        if not name:
            raise ValueError(f"Invalid command near {source[index:index + 20]!r}")

        options: list[str] = []
        args: list[str] = []
        cursor = skip_whitespace(source, cursor)
        while cursor < len(source) and source[cursor] == "[":
            option, cursor = parse_group(source, cursor, "[", "]")
            options.append(option.strip())
            cursor = skip_whitespace(source, cursor)
        while cursor < len(source) and source[cursor] == "{":
            arg, cursor = parse_group(source, cursor, "{", "}")
            args.append(arg)
            cursor = skip_whitespace(source, cursor)
            if name not in {"wire", "gate", "meter", "gategroup", "slice", "ghost", "ctrl", "octrl", "swap", "lstick", "rstick", "control", "ocontrol", "targ", "targX", "wireoverride", "setwiretype", "vqw", "vcw", "qwbundle", "color"}:
                break
            if name in {"gate", "meter", "gategroup", "slice", "ghost", "ctrl", "octrl", "swap", "lstick", "rstick", "vqw", "vcw", "qwbundle", "wireoverride", "setwiretype", "control", "ocontrol", "targ", "targX", "color"}:
                break
            if name == "wire":
                break
        commands.append(ParsedCommand(name=name, options=options, args=args))
        index = cursor
    return commands


def stringify_command(command: ParsedCommand) -> str:
    options = "".join(f"[{option}]" for option in command.options)
    args = "".join(f"{{{arg}}}" for arg in command.args)
    return f"\\{command.name}{options}{args}"


def parse_wires_option(options: list[str]) -> int:
    for option_text in options:
        for option in split_options(option_text):
            if option.lower().startswith("wires="):
                value = parse_int(option.split("=", 1)[1])
                if value is not None and value > 0:
                    return value
            if option.isdigit():
                return max(1, int(option))
    return 1


def parse_environment_wire_types(options: str, rows: int) -> list[str]:
    match = re.search(r"wire\s*types\s*=\s*\{([^}]*)\}", options, re.I)
    result = ["quantum"] * rows
    if not match:
        return result
    entries = [entry.strip().lower() for entry in split_options(match.group(1))]
    for row in range(min(rows, len(entries))):
        if entries[row] == "c":
            result[row] = "classical"
    return result


def parse_label_command(cell: str, command_name: str) -> tuple[LabelCommand | None, str]:
    trimmed = cell.strip()
    if not trimmed:
        return None, ""
    commands = parse_command_sequence(trimmed)
    index = next((position for position, command in enumerate(commands) if command.name == command_name and command.args), -1)
    if index == -1:
        return None, trimmed
    command = commands[index]
    remainder = " ".join(stringify_command(entry) for position, entry in enumerate(commands) if position != index).strip()
    return LabelCommand(label=decode_label(command.args[0]), span=parse_wires_option(command.options)), remainder


def decode_label(value: str) -> str:
    trimmed = value.strip()
    if trimmed.startswith("$") and trimmed.endswith("$") and len(trimmed) >= 2:
        trimmed = trimmed[1:-1].strip()
    trimmed = trimmed.replace(r"\textbackslash{}", "\\")
    trimmed = trimmed.replace(r"\textasciitilde{}", "~")
    trimmed = trimmed.replace(r"\^{}", "^")
    trimmed = re.sub(r"\\([&%$#_{}])", r"\1", trimmed)
    return trimmed


def parse_int(value: str) -> int | None:
    try:
        return int(value.strip())
    except ValueError:
        return None


def parse_connector(command: ParsedCommand, row: int) -> ConnectorRef | None:
    if command.name == "vqw":
        offset = parse_int(command.args[0]) if command.args else None
        if offset is None or offset == 0:
            return None
        return ConnectorRef(row=row, endpoint=row + offset, wire_type="quantum", source="vqw")
    if command.name == "vcw":
        offset = parse_int(command.args[0]) if command.args else None
        if offset is None or offset == 0:
            return None
        return ConnectorRef(row=row, endpoint=row + offset, wire_type="classical", source="vcw")
    if command.name != "wire":
        return None

    direction = command.options[0].strip().lower() if command.options else ""
    length = parse_int(command.options[1]) if len(command.options) >= 2 else None
    if length is None or length == 0:
        return None
    endpoint = row + length if direction != "u" else row - length
    wire_type = "classical" if command.args and command.args[0].strip().lower() == "c" else "quantum"
    return ConnectorRef(row=row, endpoint=endpoint, wire_type=wire_type, source="wire")


def label_for_rows(row_labels: list[str], start_row: int, span: int) -> str:
    qubits = [f"q{row}" for row in range(start_row, start_row + span)]
    return ",".join(qubits)


def describe_controls(controls: list[tuple[int, str]]) -> str:
    parts: list[str] = []
    for row, state in sorted(controls):
        parts.append(f"q{row}={'1' if state == '1' else '0'}")
    return ", ".join(parts)


def bit_mask(num_qubits: int, qubit: int) -> int:
    return 1 << (num_qubits - 1 - qubit)


def bit_value(state: int, num_qubits: int, qubit: int) -> int:
    return 1 if state & bit_mask(num_qubits, qubit) else 0


def render_basis_state(state: int, num_qubits: int) -> str:
    return f"|{format(state, f'0{num_qubits}b')}>"


def add_expr(left: str, right: str) -> str:
    if left == "0":
        return right
    if right == "0":
        return left
    if left == right:
        return f"2*({left})"
    return f"({left}) + ({right})"


def sub_expr(left: str, right: str) -> str:
    if right == "0":
        return left
    if left == "0":
        return f"-({right})"
    if left == right:
        return "0"
    return f"({left}) - ({right})"


def mul_expr(prefix: str, expr: str) -> str:
    if prefix == "0" or expr == "0":
        return "0"
    if prefix == "1":
        return expr
    if expr == "1":
        return prefix
    if prefix == "-1":
        return f"-({expr})"
    return f"{prefix}*({expr})"


def div_expr(expr: str, denominator: str) -> str:
    if expr == "0":
        return "0"
    if denominator == "1":
        return expr
    if re.fullmatch(r"[A-Za-z0-9_\\]+", expr):
        return f"{expr}/{denominator}"
    return f"({expr})/{denominator}"


def render_statevector(terms: dict[int, str], num_qubits: int) -> str:
    pieces: list[str] = []
    for state, amplitude in sorted(terms.items()):
        if amplitude == "0":
            continue
        ket = render_basis_state(state, num_qubits)
        if amplitude == "1":
            pieces.append(ket)
        elif amplitude == "-1":
            pieces.append(f"-{ket}")
        else:
            pieces.append(f"{amplitude}{ket}")
    if not pieces:
        return "0"
    return " + ".join(pieces).replace("+ -", "- ")


def render_statevector_on_qubits(terms: dict[int, str], qubits: list[int]) -> str:
    pieces: list[str] = []
    for state, amplitude in sorted(terms.items()):
        if amplitude == "0":
            continue
        ket = render_basis_state(state, len(qubits))
        if amplitude == "1":
            pieces.append(ket)
        elif amplitude == "-1":
            pieces.append(f"-{ket}")
        else:
            pieces.append(f"{amplitude}{ket}")
    if not pieces:
        return "0"
    return " + ".join(pieces).replace("+ -", "- ")


def try_parse_rational(value: str) -> Fraction | None:
    normalized = strip_outer_parentheses(value.strip())
    if not normalized:
        return None
    if re.fullmatch(r"-?\d+", normalized):
        return Fraction(int(normalized), 1)
    match = re.fullmatch(r"(-?\d+)\s*/\s*(\d+)", normalized)
    if match is None:
        return None
    denominator = int(match.group(2))
    if denominator == 0:
        return None
    return Fraction(int(match.group(1)), denominator)


def render_rational(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"


def add_scalar_expr(left: str, right: str) -> str:
    if left == "0":
        return right
    if right == "0":
        return left
    left_rational = try_parse_rational(left)
    right_rational = try_parse_rational(right)
    if left_rational is not None and right_rational is not None:
        return render_rational(left_rational + right_rational)
    if left == right:
        return mul_scalar_expr("2", left)
    return f"({left}) + ({right})"


def mul_scalar_expr(left: str, right: str) -> str:
    if left == "0" or right == "0":
        return "0"
    if left == "1":
        return right
    if right == "1":
        return left
    left_rational = try_parse_rational(left)
    right_rational = try_parse_rational(right)
    if left_rational is not None and right_rational is not None:
        return render_rational(left_rational * right_rational)
    return f"{left}*({right})" if re.fullmatch(r"[A-Za-z0-9_\\]+", left) else f"({left})*({right})"


def div_scalar_expr(left: str, right: str) -> str:
    if left == "0":
        return "0"
    if right == "1":
        return left
    left_rational = try_parse_rational(left)
    right_rational = try_parse_rational(right)
    if left_rational is not None and right_rational is not None and right_rational != 0:
        return render_rational(left_rational / right_rational)
    return f"{left}/{right}" if re.fullmatch(r"[A-Za-z0-9_\\]+", left) else f"({left})/{right}"


def sqrt_scalar_expr(value: str) -> str:
    normalized = strip_outer_parentheses(value.strip())
    if normalized == "0":
        return "0"
    if normalized == "1":
        return "1"
    rational = try_parse_rational(normalized)
    if rational is not None and rational >= 0:
        numerator_root = int(rational.numerator ** 0.5)
        denominator_root = int(rational.denominator ** 0.5)
        if numerator_root * numerator_root == rational.numerator and denominator_root * denominator_root == rational.denominator:
            return render_rational(Fraction(numerator_root, denominator_root))
    return f"sqrt({normalized})"


def abs_sq_expr(expr: str) -> str:
    normalized = strip_outer_parentheses(expr.strip())
    if not normalized or normalized == "0":
        return "0"
    if normalized.startswith("-") and len(normalized) > 1:
        return abs_sq_expr(normalized[1:])
    if normalized in {"1", "i"}:
        return "1"
    if re.fullmatch(r"-?\d+", normalized):
        integer = int(normalized)
        return str(integer * integer)
    if normalized.startswith("exp(") and normalized.endswith(")"):
        return "1"
    if normalized.startswith("sqrt(") and normalized.endswith(")"):
        inner = normalized[5:-1].strip()
        rational = try_parse_rational(inner)
        if rational is not None:
            return render_rational(rational)
        return f"|{normalized}|^2"

    sum_pieces = split_top_level_expression(normalized, {"+", "-"})
    if len(sum_pieces) > 1:
        return f"|{normalized}|^2"

    division_pieces = split_top_level_expression(normalized, {"/"})
    if len(division_pieces) > 1:
        result = abs_sq_expr(division_pieces[0][1])
        for _, piece in division_pieces[1:]:
            result = div_scalar_expr(result, abs_sq_expr(piece))
        return result

    product_pieces = split_top_level_expression(normalized, {"*"})
    if len(product_pieces) > 1:
        result = "1"
        for _, piece in product_pieces:
            result = mul_scalar_expr(result, abs_sq_expr(piece))
        return result

    rational = try_parse_rational(normalized)
    if rational is not None:
        return render_rational(rational * rational)
    return f"|{normalized}|^2"


def encode_subspace_state(full_state: int, num_qubits: int, qubits: list[int]) -> int:
    encoded = 0
    for qubit in qubits:
        encoded = (encoded << 1) | bit_value(full_state, num_qubits, qubit)
    return encoded


def format_measurement_assignment(measured_qubits: list[int], outcome: str) -> str:
    return ", ".join(f"q{qubit}={bit}" for qubit, bit in zip(measured_qubits, outcome))


def format_measurement_state(outcomes: list["MeasurementOutcome"]) -> str:
    parts: list[str] = []
    for outcome in outcomes:
        assignment = format_measurement_assignment(outcome.measured_qubits, outcome.outcome)
        if outcome.remaining_state is None:
            parts.append(f"Outcome {assignment} with probability {outcome.probability}; all qubits measured")
        elif not outcome.remaining_qubits:
            parts.append(f"Outcome {assignment} with probability {outcome.probability}")
        else:
            remaining_label = ", ".join(f"q{qubit}" for qubit in outcome.remaining_qubits)
            parts.append(
                f"Outcome {assignment} with probability {outcome.probability}; remaining state on {remaining_label}: {outcome.remaining_state}"
            )
    return "; ".join(parts)


def project_measurement_outcomes(
    terms: dict[int, str],
    num_qubits: int,
    measured_qubits: list[int],
) -> list["MeasurementOutcome"]:
    ordered_measured = sorted(dict.fromkeys(measured_qubits))
    remaining_qubits = [qubit for qubit in range(num_qubits) if qubit not in ordered_measured]
    projected: dict[str, dict[int, str]] = {}

    for full_state, amplitude in terms.items():
        if amplitude == "0":
            continue
        outcome_bits = "".join(str(bit_value(full_state, num_qubits, qubit)) for qubit in ordered_measured)
        reduced_state = encode_subspace_state(full_state, num_qubits, remaining_qubits)
        bucket = projected.setdefault(outcome_bits, {})
        bucket[reduced_state] = add_expr(bucket.get(reduced_state, "0"), amplitude)

    outcomes: list[MeasurementOutcome] = []
    for outcome_bits, branch_terms in sorted(projected.items()):
        probability = "0"
        for amplitude in branch_terms.values():
            probability = add_scalar_expr(probability, abs_sq_expr(amplitude))

        nonzero_terms = {state: amplitude for state, amplitude in branch_terms.items() if amplitude != "0"}
        if probability == "0" or not nonzero_terms:
            continue
        remaining_state: str | None
        if not remaining_qubits:
            remaining_state = None
        elif len(nonzero_terms) == 1:
            only_state = next(iter(nonzero_terms))
            remaining_state = render_basis_state(only_state, len(remaining_qubits))
        elif probability == "1":
            remaining_state = render_statevector_on_qubits(nonzero_terms, remaining_qubits)
        else:
            normalization = sqrt_scalar_expr(probability)
            normalized_terms = {
                state: div_expr(amplitude, normalization)
                for state, amplitude in nonzero_terms.items()
            }
            remaining_state = render_statevector_on_qubits(normalized_terms, remaining_qubits)

        outcomes.append(
            MeasurementOutcome(
                outcome=outcome_bits,
                measured_qubits=ordered_measured,
                remaining_qubits=remaining_qubits,
                probability=probability,
                remaining_state=remaining_state,
            )
        )
    return outcomes


def canonical_gate_label(label: str) -> str:
    normalized = label.strip()
    normalized = re.sub(r"\\mathrm\{([^{}]+)\}", r"\1", normalized)
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace(r"T^{\dagger}", "Tdg")
    normalized = normalized.replace(r"T^\dagger", "Tdg")
    normalized = normalized.replace(r"T^{\\dagger}", "Tdg")
    normalized = normalized.replace(r"R_Z", "RZ")
    return normalized


def parse_rz_parameter(canonical_label: str) -> str | None:
    match = re.fullmatch(r"RZ\((.*)\)", canonical_label)
    return match.group(1) if match else None


def apply_single_qubit_gate(terms: dict[int, str], num_qubits: int, qubit: int, label: str) -> dict[int, str] | None:
    canonical = canonical_gate_label(label)
    next_terms = dict(terms)
    mask = bit_mask(num_qubits, qubit)
    visited: set[int] = set()
    result: dict[int, str] = {}

    if canonical in {"Z", "S", "T", "Tdg"} or parse_rz_parameter(canonical) is not None:
        phase_for_one = {
            "Z": "-1",
            "S": "i",
            "T": "exp(i*pi/4)",
            "Tdg": "exp(-i*pi/4)",
        }.get(canonical)
        rz_parameter = parse_rz_parameter(canonical)
        for state, amplitude in next_terms.items():
            if rz_parameter is not None:
                phase = f"exp(i*({rz_parameter})/2)" if state & mask else f"exp(-i*({rz_parameter})/2)"
                result[state] = mul_expr(phase, amplitude)
            elif state & mask:
                result[state] = mul_expr(phase_for_one or "1", amplitude)
            else:
                result[state] = amplitude
        return result

    for state in sorted(next_terms):
        if state in visited:
            continue
        partner = state ^ mask
        visited.add(state)
        visited.add(partner)
        zero_state = state & ~mask
        one_state = zero_state | mask
        amplitude_zero = next_terms.get(zero_state, "0")
        amplitude_one = next_terms.get(one_state, "0")

        if canonical == "H":
            result[zero_state] = div_expr(add_expr(amplitude_zero, amplitude_one), "sqrt(2)")
            result[one_state] = div_expr(sub_expr(amplitude_zero, amplitude_one), "sqrt(2)")
        elif canonical == "X":
            result[zero_state] = amplitude_one
            result[one_state] = amplitude_zero
        elif canonical == "Y":
            result[zero_state] = mul_expr("-i", amplitude_one)
            result[one_state] = mul_expr("i", amplitude_zero)
        else:
            return None

    return result


def controls_match(state: int, num_qubits: int, controls: list[tuple[int, str]]) -> bool:
    for qubit, control_state in controls:
        expected = 1 if control_state == "1" else 0
        if bit_value(state, num_qubits, qubit) != expected:
            return False
    return True


def apply_controlled_x(
    terms: dict[int, str],
    num_qubits: int,
    controls: list[tuple[int, str]],
    target: int,
) -> dict[int, str]:
    result: dict[int, str] = {}
    mask = bit_mask(num_qubits, target)
    for state, amplitude in terms.items():
        if controls_match(state, num_qubits, controls):
            result[state ^ mask] = amplitude
        else:
            result[state] = amplitude
    return result


def apply_swap(
    terms: dict[int, str],
    num_qubits: int,
    left: int,
    right: int,
    controls: list[tuple[int, str]] | None = None,
) -> dict[int, str]:
    controls = controls or []
    result: dict[int, str] = {}
    left_mask = bit_mask(num_qubits, left)
    right_mask = bit_mask(num_qubits, right)
    for state, amplitude in terms.items():
        if not controls_match(state, num_qubits, controls):
            result[state] = amplitude
            continue
        left_bit = 1 if state & left_mask else 0
        right_bit = 1 if state & right_mask else 0
        swapped_state = state
        if left_bit != right_bit:
            swapped_state ^= left_mask
            swapped_state ^= right_mask
        result[swapped_state] = amplitude
    return result


def initial_basis_state(row_labels: list[str], wire_types: list[str]) -> dict[int, str] | None:
    bits: list[str] = []
    for row, label in enumerate(row_labels):
        if wire_types[row] != "quantum":
            return None
        normalized = collapse_whitespace(label)
        if normalized == r"\ket{0}":
            bits.append("0")
        elif normalized == r"\ket{1}":
            bits.append("1")
        else:
            return None
    state = int("".join(bits), 2) if bits else 0
    return {state: "1"}


def format_initial_state(row_labels: list[str], label_spans: dict[int, tuple[str, int]]) -> str:
    parts: list[str] = []
    consumed: set[int] = set()
    for row in range(len(row_labels)):
        if row in consumed:
            continue
        span_entry = label_spans.get(row)
        if span_entry is not None:
            label, span = span_entry
            consumed.update(range(row, row + span))
            if span == 1:
                parts.append(label)
            else:
                wires = ",".join(f"q{index}" for index in range(row, row + span))
                parts.append(f"{label}_(%s)" % wires)
            continue
        if row_labels[row]:
            parts.append(row_labels[row])
        else:
            parts.append(f"|q{row}>")
    return " x ".join(parts)


def span_contains(control: ControlRef, row: int) -> bool:
    if control.endpoint is None:
        return False
    lower = min(control.row, control.endpoint)
    upper = max(control.row, control.endpoint)
    return lower <= row <= upper


def controls_for_gate(gate: GateRef, controls: list[ControlRef]) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    for control in controls:
        if control.endpoint is None:
            continue
        if gate.row <= control.endpoint < gate.row + gate.span:
            result.append((control.row, control.state))
    return sorted(result)


def controls_for_target(target: TargetRef, controls: list[ControlRef]) -> list[tuple[int, str]]:
    matched: set[tuple[int, str]] = set()
    for control in controls:
        if control.endpoint == target.row:
            matched.add((control.row, control.state))
        elif span_contains(control, target.row):
            matched.add((control.row, control.state))
        elif control.endpoint is None and target.endpoint is not None and control.row == target.endpoint:
            matched.add((control.row, control.state))
    return sorted(matched)


def controls_for_swap(swap: SwapRef, controls: list[ControlRef]) -> list[tuple[int, str]]:
    if swap.endpoint is None:
        return []
    matched: set[tuple[int, str]] = set()
    top_row = min(swap.row, swap.endpoint)
    bottom_row = max(swap.row, swap.endpoint)
    for control in controls:
        if control.endpoint == top_row or control.endpoint == bottom_row:
            matched.add((control.row, control.state))
        elif control.endpoint is not None and top_row <= control.endpoint <= bottom_row:
            matched.add((control.row, control.state))
    return sorted(matched)


def is_substantive_column(column_cells: list[str]) -> bool:
    substantive_commands = {
        "gate",
        "meter",
        "ctrl",
        "octrl",
        "control",
        "ocontrol",
        "targ",
        "targX",
        "swap",
        "vqw",
        "vcw",
        "wire",
    }
    for cell in column_cells:
        if not cell.strip():
            continue
        commands = parse_command_sequence(cell)
        if any(command.name in substantive_commands for command in commands):
            return True
    return False


def analyze_slice(
    index: int,
    column_cells: list[str],
    row_labels: list[str],
    wire_types: list[str],
) -> tuple[SliceEvolution, list[ExecutableOp]]:
    controls: list[ControlRef] = []
    gates: list[GateRef] = []
    meters: list[MeterRef] = []
    targets: list[TargetRef] = []
    swaps: list[SwapRef] = []
    connectors: list[ConnectorRef] = []
    slice_labels: list[str] = []
    notes: list[str] = []
    unresolved_raw: list[str] = []

    for row, cell in enumerate(column_cells):
        if not cell.strip():
            continue
        commands = parse_command_sequence(cell)
        for command in commands:
            if command.name == "raw":
                unresolved_raw.extend(command.args)
            elif command.name == "gate":
                gates.append(GateRef(row=row, span=parse_wires_option(command.options), label=command.args[0] if command.args else "?"))
            elif command.name == "meter":
                meters.append(MeterRef(row=row, span=parse_wires_option(command.options)))
            elif command.name in {"ctrl", "octrl"}:
                offset = parse_int(command.args[0]) if command.args else None
                controls.append(
                    ControlRef(
                        row=row,
                        endpoint=row + offset if offset is not None else None,
                        state="0" if command.name == "octrl" else "1",
                        source=command.name,
                    )
                )
            elif command.name in {"control", "ocontrol"}:
                controls.append(ControlRef(row=row, endpoint=None, state="0" if command.name == "ocontrol" else "1", source=command.name))
            elif command.name == "targ":
                offset = parse_int(command.args[0]) if command.args and command.args[0].strip() else None
                targets.append(TargetRef(row=row, endpoint=row + offset if offset is not None else None))
            elif command.name == "swap":
                offset = parse_int(command.args[0]) if command.args else None
                swaps.append(SwapRef(row=row, endpoint=row + offset if offset is not None else None))
            elif command.name in {"vqw", "vcw", "wire"}:
                connector = parse_connector(command, row)
                if connector is not None:
                    connectors.append(connector)
            elif command.name == "slice" and command.args:
                slice_labels.append(decode_label(command.args[0]))
            elif command.name == "ghost":
                notes.append(f"q{row}: ghost continuation {command.args[0] if command.args else ''}".strip())
            elif command.name not in KNOWN_NOOPS and command.name != "targX":
                raw_text = stringify_command(command)
                notes.append(f"q{row}: ignored {raw_text}")

    executable_ops: list[ExecutableOp] = []
    operation_texts: list[tuple[int, str]] = []
    consumed_targets: set[int] = set()
    used_control_rows: set[int] = set()

    for swap in swaps:
        if swap.endpoint is None:
            notes.append(f"q{swap.row}: unresolved swap without endpoint")
            continue
        controls_here = controls_for_swap(swap, controls)
        used_control_rows.update(row for row, _ in controls_here)
        top_row = min(swap.row, swap.endpoint)
        bottom_row = max(swap.row, swap.endpoint)
        if controls_here:
            control_text = describe_controls(controls_here)
            display = f"CSWAP({control_text}; q{top_row}, q{bottom_row})"
        else:
            display = f"SWAP(q{top_row}, q{bottom_row})"
        operation_texts.append((top_row, display))
        executable_ops.append(
            ExecutableOp(
                kind="swap",
                display=display,
                sort_key=top_row,
                controls=controls_here,
                qubits=[top_row, bottom_row],
            )
        )

    for gate in gates:
        controls_here = controls_for_gate(gate, controls)
        used_control_rows.update(row for row, _ in controls_here)
        qubits = list(range(gate.row, gate.row + gate.span))
        if controls_here:
            display = f"C[{describe_controls(controls_here)}] {gate.label}({label_for_rows(row_labels, gate.row, gate.span)})"
        else:
            display = f"{gate.label}({label_for_rows(row_labels, gate.row, gate.span)})"
        operation_texts.append((gate.row, display))
        executable_ops.append(
            ExecutableOp(
                kind="gate",
                display=display,
                sort_key=gate.row,
                qubit=gate.row if gate.span == 1 else None,
                label=gate.label,
                controls=controls_here,
                qubits=qubits,
            )
        )

    classical_connector_map: dict[int, list[int]] = {}
    for connector in connectors:
        if connector.wire_type == "classical":
            classical_connector_map.setdefault(connector.row, []).append(connector.endpoint)

    for target in sorted(targets, key=lambda entry: entry.row):
        if target.row in consumed_targets:
            continue
        controls_here = controls_for_target(target, controls)
        if controls_here:
            used_control_rows.update(row for row, _ in controls_here)
            display = f"MCX({describe_controls(controls_here)} -> q{target.row})"
            operation_texts.append((target.row, display))
            executable_ops.append(
                ExecutableOp(
                    kind="controlled_x",
                    display=display,
                    sort_key=target.row,
                    controls=controls_here,
                    targets=[target.row],
                )
            )
        else:
            classical_sources = [source_row for source_row, endpoints in classical_connector_map.items() if target.row in endpoints]
            if classical_sources:
                sources = ", ".join(f"m(q{row})" for row in sorted(classical_sources))
                display = f"cX({sources} -> q{target.row})"
                operation_texts.append((target.row, display))
                notes.append(f"q{target.row}: classical control treated symbolically")
            else:
                display = f"X(q{target.row})"
                operation_texts.append((target.row, display))
                executable_ops.append(
                    ExecutableOp(
                        kind="gate",
                        display=display,
                        sort_key=target.row,
                        qubit=target.row,
                        label="X",
                        qubits=[target.row],
                    )
                )
        consumed_targets.add(target.row)

    for meter in meters:
        measured_qubits = list(range(meter.row, meter.row + meter.span))
        rows_text = label_for_rows(row_labels, meter.row, meter.span)
        display = f"Measure({rows_text})"
        operation_texts.append((meter.row, display))
        executable_ops.append(
            ExecutableOp(
                kind="measure",
                display=display,
                sort_key=meter.row,
                qubits=measured_qubits,
            )
        )
        notes.append("measurement collapses symbolic expansion")

    for connector in connectors:
        if connector.wire_type == "quantum":
            notes.append(f"q{connector.row}: quantum connector to q{connector.endpoint} kept as annotation")
        elif connector.endpoint < 0 or connector.endpoint >= len(row_labels):
            notes.append(f"q{connector.row}: connector leaves circuit bounds")

    for control in controls:
        if control.row not in used_control_rows and control.endpoint is not None:
            notes.append(f"q{control.row}: unresolved control toward q{control.endpoint}")
        elif control.row not in used_control_rows and control.endpoint is None:
            notes.append(f"q{control.row}: standalone control annotation")

    if unresolved_raw:
        notes.extend(collapse_whitespace(text) for text in unresolved_raw if collapse_whitespace(text))

    operations = [text for _, text in sorted(operation_texts, key=lambda item: (item[0], item[1]))]
    slice_evolution = SliceEvolution(index=index, labels=sorted(set(slice_labels)), operations=operations, state="", notes=notes)
    return slice_evolution, sorted(executable_ops, key=lambda op: (op.sort_key, op.display))


def evolve_statevector(
    slice_evolution: SliceEvolution,
    executable_ops: list[ExecutableOp],
    previous_terms: dict[int, str] | None,
    num_qubits: int,
) -> tuple[dict[int, str] | None, list[MeasurementOutcome]]:
    if previous_terms is None:
        return None, []

    next_terms = dict(previous_terms)
    measured_qubits: list[int] = []
    for operation in executable_ops:
        if operation.kind == "gate":
            if operation.controls:
                return None, []
            if operation.qubit is None or operation.label is None:
                return None, []
            updated = apply_single_qubit_gate(next_terms, num_qubits, operation.qubit, operation.label)
            if updated is None:
                return None, []
            next_terms = updated
        elif operation.kind == "controlled_x":
            if len(operation.targets) != 1:
                return None, []
            next_terms = apply_controlled_x(next_terms, num_qubits, operation.controls, operation.targets[0])
        elif operation.kind == "swap":
            if len(operation.qubits) != 2:
                return None, []
            next_terms = apply_swap(next_terms, num_qubits, operation.qubits[0], operation.qubits[1], operation.controls)
        elif operation.kind == "measure":
            measured_qubits.extend(operation.qubits)
        else:
            return None, []

    if any(operation.startswith("cX(") for operation in slice_evolution.operations):
        return None, []
    if measured_qubits:
        return None, project_measurement_outcomes(next_terms, num_qubits, measured_qubits)
    return next_terms, []


def symbolic_evolution_for_environment(environment: QuantikzEnvironment) -> CircuitEvolution:
    cleaned_body = strip_comments(environment.body).strip()
    raw_rows = [row.strip() for row in split_top_level(cleaned_body, "\\\\") if row.strip()]
    if not raw_rows:
        raise ValueError(f"Environment {environment.index} does not contain any circuit rows")

    row_cells: list[list[str]] = []
    row_labels = [""] * len(raw_rows)
    label_spans: dict[int, tuple[str, int]] = {}

    for row_index, raw_row in enumerate(raw_rows):
        cells = [cell.strip() for cell in split_top_level(raw_row, "&")]
        left_label, first_remainder = parse_label_command(cells[0] if cells else "", "lstick")
        if left_label is not None:
            row_labels[row_index] = left_label.label
            label_spans[row_index] = (left_label.label, left_label.span)
            cells[0] = first_remainder
        right_label, last_remainder = parse_label_command(cells[-1] if cells else "", "rstick")
        if right_label is not None:
            cells[-1] = last_remainder
        row_cells.append(cells)

    columns = max(len(cells) for cells in row_cells)
    normalized_rows = [cells + [""] * (columns - len(cells)) for cells in row_cells]
    active_columns = list(range(columns))
    while active_columns and not is_substantive_column([normalized_rows[row][active_columns[0]] for row in range(len(normalized_rows))]):
        active_columns.pop(0)
    while active_columns and not is_substantive_column([normalized_rows[row][active_columns[-1]] for row in range(len(normalized_rows))]):
        active_columns.pop()
    if active_columns:
        normalized_rows = [[row_cells[column] for column in active_columns] for row_cells in normalized_rows]
        columns = len(active_columns)
    else:
        normalized_rows = [[] for _ in normalized_rows]
        columns = 0
    wire_types = parse_environment_wire_types(environment.options, len(raw_rows))
    initial_state = format_initial_state(row_labels, label_spans)
    basis_terms = initial_basis_state(row_labels, wire_types)

    slices: list[SliceEvolution] = []
    symbolic_terms = basis_terms
    previous_state_name = "|psi_0>"

    for column in range(columns):
        column_cells = [normalized_rows[row][column] for row in range(len(normalized_rows))]
        slice_evolution, executable_ops = analyze_slice(column + 1, column_cells, row_labels, wire_types)
        if not slice_evolution.operations:
            slice_evolution.operations = ["Identity"]
        next_terms, measurement_outcomes = evolve_statevector(slice_evolution, executable_ops, symbolic_terms, len(raw_rows))
        if next_terms is not None:
            expanded_state = render_statevector(next_terms, len(raw_rows))
            slice_evolution.expanded_state = expanded_state
            slice_evolution.state = expanded_state
        elif measurement_outcomes:
            slice_evolution.measurement_outcomes = measurement_outcomes
            slice_evolution.state = format_measurement_state(measurement_outcomes)
        else:
            operation_text = " o ".join(slice_evolution.operations)
            slice_evolution.state = f"{operation_text} {previous_state_name}"
        symbolic_terms = next_terms
        previous_state_name = f"|psi_{column + 1}>"
        slices.append(slice_evolution)

    return CircuitEvolution(
        index=environment.index,
        title=environment.title,
        rows=len(raw_rows),
        columns=columns,
        initial_state=initial_state,
        slices=slices,
        source=environment.source,
    )


def symbolic_evolution_for_source(source_text: str) -> list[CircuitEvolution]:
    environments = find_quantikz_environments(source_text)
    if not environments:
        raise ValueError("No quantikz environment found")
    return [symbolic_evolution_for_environment(environment) for environment in environments]


def symbolic_evolution_for_file(path: str | pathlib.Path) -> list[CircuitEvolution]:
    source_text = pathlib.Path(path).read_text(encoding="utf-8")
    return symbolic_evolution_for_source(source_text)


def evolution_to_dict(evolution: CircuitEvolution) -> dict[str, object]:
    return {
        "index": evolution.index,
        "title": evolution.title,
        "rows": evolution.rows,
        "columns": evolution.columns,
        "initial_state": evolution.initial_state,
        "source": evolution.source,
        "slices": [
            {
                "index": slice_evolution.index,
                "labels": slice_evolution.labels,
                "operations": slice_evolution.operations,
                "state": slice_evolution.state,
                "expanded_state": slice_evolution.expanded_state,
                "measurement_outcomes": [
                    {
                        "outcome": outcome.outcome,
                        "measured_qubits": outcome.measured_qubits,
                        "remaining_qubits": outcome.remaining_qubits,
                        "probability": outcome.probability,
                        "remaining_state": outcome.remaining_state,
                    }
                    for outcome in slice_evolution.measurement_outcomes
                ],
                "notes": slice_evolution.notes,
            }
            for slice_evolution in evolution.slices
        ],
    }


def escape_latex_text(value: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "{": r"\{",
        "}": r"\}",
        "#": r"\#",
        "$": r"\$",
        "%": r"\%",
        "&": r"\&",
        "_": r"\_",
    }
    return "".join(replacements.get(char, char) for char in value)


def render_inline_verbatim(value: str) -> str:
    if "\n" in value:
        escaped = escape_latex_text(value)
        return rf"\texttt{{{escaped}}}"
    for delimiter in ["|", "!", "+", "/", ":", ";", "@"]:
        if delimiter not in value:
            return rf"\verb{delimiter}{value}{delimiter}"
    escaped = escape_latex_text(value)
    return rf"\texttt{{{escaped}}}"


def replace_named_tokens(value: str) -> str:
    value = re.sub(r"\bpi\b", r"\\pi", value)
    value = re.sub(r"\bpsi_(\d+)\b", r"\\psi_{\1}", value)
    value = re.sub(r"\bq(\d+)\b", r"q_{\1}", value)
    return value


def strip_outer_parentheses(value: str) -> str:
    trimmed = value.strip()
    while trimmed.startswith("(") and trimmed.endswith(")"):
        depth = 0
        balanced = True
        for index, char in enumerate(trimmed):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(trimmed) - 1:
                    balanced = False
                    break
        if not balanced or depth != 0:
            break
        trimmed = trimmed[1:-1].strip()
    return trimmed


def split_top_level_expression(value: str, operators: set[str]) -> list[tuple[str, str]]:
    pieces: list[tuple[str, str]] = []
    depth = 0
    start = 0
    pending_sign = "+"
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif (
            depth == 0
            and char in operators
            and index > 0
            and value[index - 1] not in "+-*/("
        ):
            pieces.append((pending_sign, value[start:index].strip()))
            pending_sign = char
            start = index + 1
    pieces.append((pending_sign, value[start:].strip()))
    return [(sign, piece) for sign, piece in pieces if piece]


def latexify_scalar_expression(value: str) -> str:
    expr = strip_outer_parentheses(value.strip())
    if not expr:
        return ""

    sum_pieces = split_top_level_expression(expr, {"+", "-"})
    if len(sum_pieces) > 1:
        rendered_parts: list[str] = []
        for position, (sign, piece) in enumerate(sum_pieces):
            rendered_piece = latexify_scalar_expression(piece)
            if position == 0 and sign == "+":
                rendered_parts.append(rendered_piece)
            elif sign == "+":
                rendered_parts.append(f"+ {rendered_piece}")
            else:
                rendered_parts.append(f"- {rendered_piece}")
        return " ".join(rendered_parts)

    product_pieces = split_top_level_expression(expr, {"*"})
    if len(product_pieces) > 1:
        return " ".join(latexify_scalar_expression(piece) for _, piece in product_pieces)

    division_pieces = split_top_level_expression(expr, {"/"})
    if len(division_pieces) > 1:
        numerator = latexify_scalar_expression(division_pieces[0][1])
        denominator = latexify_scalar_expression(division_pieces[1][1])
        rendered = rf"\frac{{{numerator}}}{{{denominator}}}"
        for _, piece in division_pieces[2:]:
            rendered = rf"\frac{{{rendered}}}{{{latexify_scalar_expression(piece)}}}"
        return rendered

    if expr.startswith("exp(") and expr.endswith(")"):
        return rf"e^{{{latexify_scalar_expression(expr[4:-1])}}}"
    if expr.startswith("sqrt(") and expr.endswith(")"):
        return rf"\sqrt{{{latexify_scalar_expression(expr[5:-1])}}}"
    if expr.startswith("-") and len(expr) > 1:
        return f"-{latexify_scalar_expression(expr[1:])}"
    if expr.startswith("\\"):
        return replace_named_tokens(expr)
    return replace_named_tokens(expr)


def latexify_ket(value: str) -> str:
    content = replace_named_tokens(value)
    return rf"\ket{{{content}}}"


def latexify_statevector(state: str) -> str:
    pieces = split_top_level_expression(state.strip(), {"+", "-"})
    rendered_terms: list[str] = []
    for position, (sign, piece) in enumerate(pieces):
        ket_match = re.search(r"\|([^>]+)>$", piece)
        if ket_match is None:
            raise ValueError(f"State term does not end with a ket: {piece}")
        ket = latexify_ket(ket_match.group(1))
        amplitude = piece[:ket_match.start()].strip()
        amplitude = amplitude[:-1].strip() if amplitude.endswith("*") else amplitude
        if amplitude in {"", "1"}:
            rendered_term = ket
        elif amplitude == "-1":
            rendered_term = f"-{ket}"
        else:
            rendered_term = f"{latexify_scalar_expression(amplitude)} {ket}"

        if position == 0 and sign == "+":
            rendered_terms.append(rendered_term)
        elif sign == "+":
            rendered_terms.append(f"+ {rendered_term}")
        else:
            rendered_terms.append(f"- {rendered_term}")
    return " ".join(rendered_terms)


def latexify_initial_state(initial_state: str) -> str | None:
    factors = [factor.strip() for factor in initial_state.split(" x ")]
    rendered: list[str] = []
    for factor in factors:
        if not factor:
            continue
        if factor.startswith(r"\ket{") and factor.endswith("}"):
            rendered.append(factor)
        elif factor.startswith("|") and factor.endswith(">"):
            rendered.append(latexify_ket(factor[1:-1]))
        else:
            return None
    return r" \otimes ".join(rendered) if rendered else None


def render_latex_document(evolutions: list[CircuitEvolution], input_name: str) -> str:
    lines: list[str] = [
        r"\documentclass{article}",
        r"\usepackage[margin=1in]{geometry}",
        r"\usepackage{amsmath}",
        r"\usepackage{amssymb}",
        r"\usepackage{tikz}",
        r"\usetikzlibrary{quantikz2}",
        r"\begin{document}",
        rf"\section*{{Quantikz Examples With Symbolic Evolution}}",
        rf"This document was generated from {render_inline_verbatim(input_name)} using {render_inline_verbatim('quantikz_statevector_evolution.py')}.",
        "",
    ]

    for evolution in evolutions:
        title = escape_latex_text(evolution.title or f"Circuit {evolution.index + 1}")
        lines.append(rf"\subsection*{{{title}}}")
        lines.append(r"\[")
        lines.append(evolution.source)
        lines.append(r"\]")
        initial_state_math = latexify_initial_state(evolution.initial_state)
        if initial_state_math is not None:
            lines.append(r"\[")
            lines.append(rf"\ket{{\psi_0}} = {initial_state_math}")
            lines.append(r"\]")
        else:
            lines.append(rf"\noindent\textbf{{Initial symbolic state.}} {render_inline_verbatim(evolution.initial_state)}\\")
        lines.append(r"\begin{enumerate}")
        for slice_evolution in evolution.slices:
            label_suffix = ""
            if slice_evolution.labels:
                labels = ", ".join(slice_evolution.labels)
                label_suffix = rf" [{escape_latex_text(labels)}]"
            operation_text = ", ".join(slice_evolution.operations)
            lines.append(rf"\item Slice {slice_evolution.index}{label_suffix}. Operations: {render_inline_verbatim(operation_text)}")
            lines.append(r"\[")
            if slice_evolution.expanded_state is not None:
                lines.append(
                    rf"\ket{{\psi_{slice_evolution.index}}} = {latexify_statevector(slice_evolution.expanded_state)}"
                )
            else:
                lines.append(
                    rf"\ket{{\psi_{slice_evolution.index}}} = \mathcal{{O}}_{{{slice_evolution.index}}}\ket{{\psi_{{{slice_evolution.index - 1}}}}}"
                )
            lines.append(r"\]")
            if slice_evolution.expanded_state is None:
                lines.append(
                    rf"\noindent where $\mathcal{{O}}_{{{slice_evolution.index}}}$ is the simulator output {render_inline_verbatim(slice_evolution.state)}."
                )
            if slice_evolution.measurement_outcomes:
                lines.append(r"\begin{itemize}")
                for outcome in slice_evolution.measurement_outcomes:
                    assignment = format_measurement_assignment(outcome.measured_qubits, outcome.outcome)
                    probability = render_inline_verbatim(outcome.probability)
                    if outcome.remaining_state is None:
                        remaining = "all qubits measured"
                    else:
                        remaining = render_inline_verbatim(outcome.remaining_state)
                    lines.append(
                        rf"\item Outcome {render_inline_verbatim(assignment)} with probability {probability}; remaining state: {remaining}."
                    )
                lines.append(r"\end{itemize}")
            if slice_evolution.notes:
                lines.append(r"\begin{itemize}")
                for note in slice_evolution.notes:
                    lines.append(rf"\item {render_inline_verbatim(note)}")
                lines.append(r"\end{itemize}")
        lines.append(r"\end{enumerate}")
        lines.append("")

    lines.append(r"\end{document}")
    return "\n".join(lines) + "\n"


def render_text_report(evolutions: list[CircuitEvolution]) -> str:
    lines: list[str] = []
    for evolution in evolutions:
        heading = evolution.title or f"Circuit {evolution.index + 1}"
        lines.append(f"Circuit {evolution.index + 1}: {heading}")
        lines.append(f"Initial: {evolution.initial_state}")
        for slice_evolution in evolution.slices:
            label_suffix = f" [{', '.join(slice_evolution.labels)}]" if slice_evolution.labels else ""
            lines.append(f"  Slice {slice_evolution.index}{label_suffix}:")
            lines.append(f"    Ops: {', '.join(slice_evolution.operations)}")
            lines.append(f"    State: {slice_evolution.state}")
            for outcome in slice_evolution.measurement_outcomes:
                assignment = format_measurement_assignment(outcome.measured_qubits, outcome.outcome)
                lines.append(f"    Outcome {assignment}:")
                lines.append(f"      Probability: {outcome.probability}")
                if outcome.remaining_state is None:
                    lines.append("      Remaining: all qubits measured")
                else:
                    lines.append(f"      Remaining: {outcome.remaining_state}")
            if slice_evolution.notes:
                lines.append(f"    Notes: {'; '.join(slice_evolution.notes)}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert Quantikz circuits into slice-by-slice symbolic state evolution."
    )
    parser.add_argument("input", help="Path to a TeX file containing one or more quantikz environments")
    parser.add_argument("--env-index", type=int, default=None, help="Only analyze a single quantikz environment")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    parser.add_argument("--latex-report", action="store_true", help="Emit a standalone LaTeX document")
    parser.add_argument("--output", help="Write the selected output format to a file instead of stdout")
    args = parser.parse_args()

    input_path = pathlib.Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    source_text = input_path.read_text(encoding="utf-8")
    try:
        evolutions = symbolic_evolution_for_source(source_text)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.env_index is not None:
        if args.env_index < 0 or args.env_index >= len(evolutions):
            print(
                f"Quantikz environment index {args.env_index} is out of range; found {len(evolutions)} environment(s)",
                file=sys.stderr,
            )
            return 1
        evolutions = [evolutions[args.env_index]]

    if args.json and args.latex_report:
        print("Choose either --json or --latex-report, not both", file=sys.stderr)
        return 2

    if args.json:
        output = json.dumps([evolution_to_dict(evolution) for evolution in evolutions], indent=2) + "\n"
    elif args.latex_report:
        output = render_latex_document(evolutions, input_path.name)
    else:
        output = render_text_report(evolutions)

    if args.output:
        pathlib.Path(args.output).write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
