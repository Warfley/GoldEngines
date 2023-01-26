/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";
import { CharRangeSet, CharSet, DFAState, MatchGroup } from "./lexer";
import { LRAction, LRActionType, LRState, ParserRule, ParserSymbol, SymbolType } from "./parser";

enum GrammarDataType {
  BOOLEAN = "B".charCodeAt(0),
  EMPTY = "E".charCodeAt(0),
  INT = "I".charCodeAt(0),
  STRING = "S".charCodeAt(0),
  BYTE = "b".charCodeAt(0),
  MULTI = "M".charCodeAt(0)
}

export class GTFileReader {
  private data: Buffer;
  private read_head: number = 0;
  private remaining_records: number = 0;

  public static async from_file(file: string): Promise<GTFileReader> {
    let buffer = await fs.promises.readFile(file);
    return new GTFileReader(buffer);
  }

  private constructor(data: Buffer) {
    this.data = data;
  }

  public eof(): boolean {
    return this.read_head >= this.data.length;
  }

  public read_raw_string(): string {
    for (let i=this.read_head; i<this.data.length; i += 2) {
      if (this.data.readUint16LE(i) === 0) {
        let result = this.data.subarray(this.read_head, i).toString("utf16le");
        this.read_head = i + 2;
        return result;
      }
    }
    throw new Error("Not a string to read");
  }

  private next_type(): GrammarDataType {
    let char = this.data.readUInt8(this.read_head++);
    return char;
  }

  public read_bool(): boolean {
    let type = this.next_type();
    if (type !== GrammarDataType.BOOLEAN) {
      --this.read_head;
      throw new Error("Unexpected data type");
    }
    --this.remaining_records;
    return this.data.readUInt8(this.read_head++) !== 0;
  }

  public read_empty(): void {
    let type = this.next_type();
    if (type !== GrammarDataType.EMPTY) {
      --this.read_head;
      throw new Error("Unexpected data type");
    }
    --this.remaining_records;
  }

  public read_int(): number {
    let type = this.next_type();
    if (type !== GrammarDataType.INT) {
      --this.read_head;
      throw new Error("Unexpected data type");
    }
    let result = this.data.readUInt16LE(this.read_head);
    this.read_head += 2;
    --this.remaining_records;
    return result;
  }

  public read_string(): string {
    let type = this.next_type();
    if (type !== GrammarDataType.STRING) {
      --this.read_head;
      throw new Error("Unexpected data type");
    }
    --this.remaining_records;
    return this.read_raw_string();
  }

  public read_byte(): number {
    let type = this.next_type();
    if (type !== GrammarDataType.BYTE) {
      --this.read_head;
      throw new Error("Unexpected data type");
    }
    --this.remaining_records;
    return this.data.readUInt8(this.read_head++);
  }

  public skip_field(): void {
    let type = this.next_type();
    --this.remaining_records;
    switch (type) {
      case GrammarDataType.EMPTY:
        return;

      case GrammarDataType.BOOLEAN:
      case GrammarDataType.BYTE:
        this.read_head += 1;
        return;

      case GrammarDataType.INT:
        this.read_head += 2;
        return;

      case GrammarDataType.STRING:
        this.read_raw_string();
        return;
    }

    throw new Error("Unknown data field type");
  }

  public start_record(): number {
    let type = this.next_type();
    if (type !== GrammarDataType.MULTI) {
      throw new Error("Unexpected data type");
    }
    let result = this.data.readUInt16LE(this.read_head);
    this.read_head += 2;
    this.remaining_records = result;
    return result;
  }

  public record_finished(): boolean {
    if (this.remaining_records < 0) {
      throw new Error("Overshot record");
    }
    return this.remaining_records === 0;
  }

}

enum GrammarRecordType{
  // V1
    CHARSET = "C".charCodeAt(0),
    DFASTATE ="D".charCodeAt(0),
    INITIALSTATES = "I".charCodeAt(0),
    LRSTATE ="L".charCodeAt(0),
    PARAMETER = "P".charCodeAt(0),
    RULE = "R".charCodeAt(0),
    SYMBOL = "S".charCodeAt(0),
    COUNTS = "T".charCodeAt(0),
  // V5
    CHARRANGES = "c".charCodeAt(0),
    GROUP = "g".charCodeAt(0),
    PROPERTY = "p".charCodeAt(0),
    COUNTS_V5 = "t".charCodeAt(0),
}

export interface GrammarParseResult {
  params: Map<string, string>;
  rules: Array<ParserRule>;
  dfa: DFAState;
  lalr: LRState;
}

export interface CGTSymbol {
  name: string;
  type: SymbolType
}

export interface CGTDFAState {
  result?: number;
  edges: {
    label: number;
    target: number;
  }[];
}

export interface CGTLRState {
  transitions: {
    value: number;
    action_type: LRActionType;
    look_ahead_symbol: number;
  }[];
}

export interface CGTRule {
  index: number;
  produces: number;
  consumes: Array<number>;
}

export interface CGTGroup {
  name: string;
  symbol: number;
  start_symbol: number;
  end_symbol: number;
  advance_mode: "Char"|"Token";
  ending_mode: "Open"|"Closed";

  nestable_groups: Array<number>;
}

function skip_record(file: GTFileReader) {
  while (!file.eof() && !file.record_finished()) {
    file.skip_field();
  }
}

function parse_charset(file: GTFileReader, next_index: number): CharSet {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }
  let chars = file.read_string();
  let set = new Set<string>([...chars]);
  return set;
}


function parse_dfa_state(file: GTFileReader, next_index: number): CGTDFAState {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }

  let is_final = file.read_bool();
  let result_index = file.read_int();
  file.skip_field();

  let result: CGTDFAState = {
    result: is_final
          ? result_index
          : undefined,
    edges: [],
  };

  while (!file.eof() && !file.record_finished()) {
    let label = file.read_int();
    let target_state = file.read_int();
    file.skip_field();
    result.edges.push({
      label: label,
      target: target_state
    });
  }

  return result;
}


function parse_lr_state(file: GTFileReader, next_index: number): CGTLRState {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }
  file.skip_field();

  let result: CGTLRState = {
    transitions: []
  };
  while (!file.eof() && !file.record_finished()) {
    let look_ahead_symbol = file.read_int();
    let action: LRActionType = file.read_int();
    let value = file.read_int();
    file.skip_field();
    result.transitions.push({
      action_type: action,
      look_ahead_symbol: look_ahead_symbol,
      value: value
    });
  }

  return result;
}

function parse_parameter(file: GTFileReader, params: Map<string, string>) {
    params.set("Name", file.read_string());
    params.set("Version", file.read_string());
    params.set("Author", file.read_string());
    params.set("About", file.read_string());
    params.set("Case Sensitive", file.read_bool() ? "True" : "False");
    params.set("Start Symbol", file.read_int().toString());
}


function parse_reduction(file: GTFileReader, next_index: number): CGTRule {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }
  let symbol = file.read_int();
  file.skip_field(); // reserved;

  let result: CGTRule = {
    index: index,
    produces: symbol,
    consumes: []
  };

  while (!file.eof() && !file.record_finished()) {
    let symbol = file.read_int();
    result.consumes.push(symbol);
  }

  return result;
}


function parse_symbol(file: GTFileReader, next_index: number): CGTSymbol {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }
  let name = file.read_string();
  let type: SymbolType = file.read_int();

  // To allow matching only on the basis of the name
  // This removes any ambiguity from similar named symbols
  return {
    name: name,
    type: type
  };
}


function parse_char_ranges(file: GTFileReader, next_index: number): CharSet {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }
  let codepage = file.read_int();
  let range_count = file.read_int();
  file.skip_field();

  let result = new CharRangeSet(codepage);

  for (let i=0; !file.eof() && i<range_count; ++i) {
    let start = file.read_int();
    let end = file.read_int();
    result.add_range(start, end);
  }

  return result;
}

function parse_group(file: GTFileReader, next_index: number): CGTGroup {
  let index = file.read_int();
  if (index !== next_index) {
    throw new Error("Index out of order");
  }

  let name = file.read_string();
  let group_symbol = file.read_int();
  let start_symbol = file.read_int();
  let end_symbol = file.read_int();
  let advance = file.read_int();
  let end_mode = file.read_int();

  let result: CGTGroup = {
    name: name,
    symbol: group_symbol,
    start_symbol: start_symbol,
    end_symbol: end_symbol,
    advance_mode: advance === 1 ? "Char" : "Token",
    ending_mode: end_mode === 1 ? "Closed" : "Open",
    nestable_groups: []
  };

  file.skip_field();

  let count = file.read_int();
  for (let i=0; !file.eof() && i<count; ++i) {
    result.nestable_groups.push(file.read_int());
  }

  return result;
}

function parse_property(file: GTFileReader, params: Map<string, string>) {
  file.skip_field();
  let name = file.read_string();
  let value = file.read_string();
  params.set(name, value);
}

export interface CGTData {
  version: "v1"|"v5";
  charsets: Array<CharSet>;
  params: Map<string, string>
  dfa_states: Array<CGTDFAState>;
  dfa_init_state: number;
  lr_states: Array<CGTLRState>;
  lr_init_state: number;
  rules: Array<CGTRule>;
  groups: Array<CGTGroup>;
  symbols: Array<CGTSymbol>;
}

export function load_cgt(file: GTFileReader): CGTData {
  let version_str = file.read_raw_string();
  let version_match = version_str.match(/GOLD Parser Tables\/(v1|v5).0/);
  if (version_match === null ||
     (version_match[1] !== "v1" &&
      version_match[1] !== "v5")) {
    throw new Error("Magic string not found in file");
  }
  let result: CGTData = {
    version: version_match[1],
    charsets: [],
    params: new Map<string, string>(),
    dfa_states: [],
    dfa_init_state: 0,
    lr_states: [],
    lr_init_state: 0,
    rules: [],
    groups: [],
    symbols: [],
  }

  while (!file.eof()) {
    file.start_record();
    let record_type: GrammarRecordType = file.read_byte();

    switch (record_type) {
    case GrammarRecordType.CHARSET:
      result.charsets.push(parse_charset(file, result.charsets.length));
      break;

    case GrammarRecordType.DFASTATE:
      result.dfa_states.push(parse_dfa_state(file, result.dfa_states.length));
      break;

    case GrammarRecordType.INITIALSTATES:
      result.dfa_init_state = file.read_int();
      result.lr_init_state = file.read_int();
      break;

    case GrammarRecordType.LRSTATE:
      result.lr_states.push(parse_lr_state(file, result.lr_states.length));
      break;

    case GrammarRecordType.PARAMETER:
      parse_parameter(file, result.params);
      break;

    case GrammarRecordType.RULE:
      result.rules.push(parse_reduction(file, result.rules.length));
      break;

    case GrammarRecordType.SYMBOL:
      result.symbols.push(parse_symbol(file, result.symbols.length));
      break;

    case GrammarRecordType.COUNTS:
    case GrammarRecordType.COUNTS_V5:
      // No preallocation required just skip
      skip_record(file);
      break;

    case GrammarRecordType.CHARRANGES:
      result.charsets.push(parse_char_ranges(file, result.charsets.length));
      break;

    case GrammarRecordType.GROUP:
      result.groups.push(parse_group(file, result.groups.length));
      break;

    case GrammarRecordType.PROPERTY:
      parse_property(file, result.params);
      break;
    }

    if (!file.record_finished()) {
      throw new Error("Incomplete record reading");
    }
  }
  return result;
}

function build_symbols(symbols: Array<CGTSymbol>): Array<ParserSymbol> {
  return symbols.map((symbol) => {
    // Name mangling to ensure different symbols cannot have
    // the same name
    let mangled_name = symbol.name;
    switch (symbol.type) {
    case SymbolType.TERMINAL:
      mangled_name = "'" + mangled_name + "'";
      break;
    case SymbolType.NON_TERMINAL:
      mangled_name = "<" + mangled_name + ">";
      break;
    case SymbolType.EOF:
      mangled_name = "(EOF)";
      break;
    case SymbolType.SKIPPABLE:
      mangled_name = "[" + mangled_name + "]";
      break;
    case SymbolType.GROUP_START:
      mangled_name = "/" + mangled_name + "/";
      break;
    case SymbolType.GROUP_END:
      mangled_name = "\\" + mangled_name + "\\";
    }

    return {
      name: mangled_name,
      type: symbol.type
    }
  })
}

function build_dfa(initial: number,
                   states: Array<CGTDFAState>,
                   charsets: Array<CharSet>,
                   symbols: Array<ParserSymbol>): DFAState {
  let dfa_map = new Map<number, DFAState>();

  let recursive_helper = (current: number) => {
    if (dfa_map.has(current)) {
      return dfa_map.get(current)!;
    }

    let parsed = states[current];
    let result: DFAState = {
      index: current,
      result: parsed.result === undefined
            ? undefined
            : symbols[parsed.result],
      edges: []
    };
    dfa_map.set(current, result);

    for (const edge of parsed.edges) {
      result.edges.push({
          label: charsets[edge.label],
          target: recursive_helper(edge.target)
        });
    };
    return result;
  };

  return recursive_helper(initial);
}

function build_lr(initial: number,
                  states: Array<CGTLRState>,
                  rules: Array<ParserRule>,
                  symbols: Array<ParserSymbol>) {
  let lr_map = new Map<number, LRState>();

  let recursive_helper = (current: number) => {
    if (lr_map.has(current)) {
      return lr_map.get(current)!;
    }

    let parsed = states[current];
    let result: LRState = {
      index: current,
      edges: new Map<string, LRAction>(),
      goto: new Map<string, LRAction>()
    };
    lr_map.set(current, result);

    for (const transition of parsed.transitions) {
      let edge: LRAction|"Accept";
      switch (transition.action_type) {
      case LRActionType.ACCEPT:
        edge = "Accept";
        break;

      case LRActionType.REDUCE:
        let reduction = rules[transition.value];
        edge = {
          type: LRActionType.REDUCE,
          target: reduction
        };
        break;

      case LRActionType.GOTO: // GOTO and shift have the same "Format"
      case LRActionType.SHIFT:
        edge = {
          type: transition.action_type,
          target: recursive_helper(transition.value)
        };
        break;

      default:
        throw new Error("Action type not supported");
      }
      let look_ahead = symbols[transition.look_ahead_symbol];
      if (edge !== "Accept" && edge.type === LRActionType.GOTO) {
        result.goto.set(look_ahead.name, edge);
      } else {
        result.edges.set(look_ahead.name, edge);
      }
    }

    return result;
  };

  return recursive_helper(initial);
}

function build_groups(parsed_groups: ReadonlyArray<CGTGroup>, symbols: Array<ParserSymbol>, is_v1: boolean): void {
  for (const parsed of parsed_groups) {
    let group: MatchGroup = {
      name: parsed.name,
      symbol: symbols[parsed.symbol],
      start_symbol: symbols[parsed.start_symbol],
      end_symbol: symbols[parsed.end_symbol],
      advance_mode: parsed.advance_mode,
      ending_mode: parsed.ending_mode,
      nestable_groups: new Set<string>(parsed.nestable_groups.map((nestable) => parsed_groups[nestable].name))
    };
    group.start_symbol.group = group;
    group.end_symbol.group = group;
  };

  if (is_v1) {
    // since v5 comments are used as groups
    // Old style v1 grammars had special handling
    // To handle this later on, convert v1 comments to groups
    let comment_start = symbols.find((symbol) => symbol.type === SymbolType.GROUP_START);
    let comment_end = symbols.find((symbol) => symbol.type === SymbolType.GROUP_END);
    let line_comment = symbols.find((symbol) => symbol.type === SymbolType.COMMENT_LINE);
    let new_line = symbols.find((symbol) => symbol.name.toLowerCase() === "'newline'");
    let comment_symbol = symbols.find((symbol) => symbol.name.toLowerCase() === "[comment]");
    if (comment_symbol === undefined) {
      comment_symbol = {
        name: "Comment",
        type: SymbolType.SKIPPABLE
      };
    }

    if (comment_start !== undefined &&
        comment_end !== undefined &&
        comment_symbol !== undefined) {
      let block_group: MatchGroup = {
        name: "Comment Block",
        symbol: comment_symbol,
        start_symbol: comment_start,
        end_symbol: comment_end,
        advance_mode: "Char",
        ending_mode: "Closed",
        nestable_groups: new Set<string>([])
      };
      comment_start.group = block_group;
      comment_end.group = block_group;
    }
    if (line_comment !== undefined &&
        new_line !== undefined &&
        comment_symbol !== undefined) {
      let line_group: MatchGroup = {
        name: "Comment Block",
        symbol: comment_symbol,
        start_symbol: line_comment,
        end_symbol: new_line,
        advance_mode: "Char",
        ending_mode: "Open",
        nestable_groups: new Set<string>([])
      };

      line_comment.group = line_group;
      line_comment.type = SymbolType.GROUP_START;
      new_line.group = line_group;
    }
  }
}

export function load_grammar_tables(cgt_data: CGTData): GrammarParseResult {
  let symbols = build_symbols(cgt_data.symbols);
  build_groups(cgt_data.groups, symbols, cgt_data.version === "v1");

  let rules = cgt_data.rules.map((r) => {
    return {
      produces: symbols[r.produces],
      consumes: r.consumes.map((c) => symbols[c]),
      index: r.index
    };
  });

  return {
    dfa: build_dfa(cgt_data.dfa_init_state, cgt_data.dfa_states,
                   cgt_data.charsets, symbols),
    lalr: build_lr(cgt_data.lr_init_state, cgt_data.lr_states,
                   rules, symbols),
    params: cgt_data.params,
    rules: rules
  };
}
