/* eslint-disable @typescript-eslint/naming-convention */

import { ParserSymbol, SymbolType } from "./parser";

interface CharRange {
  start: number;
  end: number;
}

export class CharRangeSet {
  public ranges: Array<CharRange> = [];
  public codepage: number = 0; // How is this encoded?

  constructor(codepage: number, ranges?: Array<CharRange>) {
    this.codepage = codepage;
    if (ranges !== undefined) {
      this.ranges = ranges;
    }
  }

  public add_range(start: number, end: number) {
    this.ranges.push({
      start: start,
      end: end,
    });
  }

  private encoding(): BufferEncoding {
    // For now: Ignore code page
    return "utf16le";
  }

  public contains(value: string): boolean {
    let code_point = Buffer.from(value, this.encoding()).readUint16LE();
    for (let range of this.ranges) {
      if (code_point >= range.start &&
          code_point <= range.end) {
        return true;
      }
    }
    return false;
  }

}

type SimpleCharset = Set<string>;

export type CharSet = SimpleCharset|CharRangeSet;

function char_in_set(char: string, charset: CharSet) {
  if (charset instanceof CharRangeSet) {
    return charset.contains(char);
  }
  return charset.has(char);
}

interface DFAEdge {
  target: DFAState;
  label: CharSet;
}

export interface DFAState {
  index: number;
  edges: Array<DFAEdge>;
  result?: ParserSymbol;
}

export interface Token {
  symbol: ParserSymbol;
  value: string;
  position: number;
  nested_tokens?: Array<Token>;
}

const EOF_SYMBOL: ParserSymbol = {
  name: "(EOF)",
  type: SymbolType.EOF
};

function edge_with_label(state: DFAState, char: string): DFAEdge|undefined {
  for (const edge of state.edges) {
    if (char_in_set(char, edge.label)) {
      return edge;
    }
  }
  return undefined;
}

function dfa_match(str: string, start_pos: number, dfa: DFAState): Token|undefined {
  // Check if already at the end, if so return EOF
  if (start_pos >= str.length) {
    return {
      position: str.length,
      symbol: EOF_SYMBOL,
      value: "(EOF)"
    };
  }

  let current_state = dfa;
  let last_match: Token|undefined = undefined;

  for (let i=start_pos; i<str.length; ++i) {
    const chr = str.charAt(i);
    let edge = edge_with_label(current_state, chr);
    // No Edge found
    if (edge === undefined) {
      break;
    }
    // switch to next state
    current_state = edge.target;
    // On final state, update last_match
    if (current_state.result !== undefined) {
      last_match = {
        value: str.substring(start_pos, i+1),
        symbol: current_state.result,
        position: start_pos
      };
    }
  }
  return last_match;
}

// -------------------------------------
// Group matching
// -------------------------------------

export interface MatchGroup {
  name: string;
  symbol: ParserSymbol;
  start_symbol: ParserSymbol;
  end_symbol: ParserSymbol;
  advance_mode: "Char"|"Token";
  ending_mode: "Open"|"Closed";

  nestable_groups: Set<string>;
}

export interface GroupError {
  groups: GroupStack;
}
export function is_group_error(result: object): result is GroupError {
  return "groups" in result;
}

interface GroupStackItem {
  group: MatchGroup,
  start_position: number
  nested_tokens: Array<Token>;
}

type GroupStack = Array<GroupStackItem>;

function close_group(stack: GroupStack, end_pos: number, str: string): Token {
  let top_group = stack.pop()!;
  let new_token = {
    position: top_group.start_position,
    symbol: top_group.group.symbol,
    value: str.substring(top_group.start_position,
                         end_pos),
    nested_tokens: top_group.nested_tokens
  };
  if (stack.length > 0) {
    stack[stack.length - 1].nested_tokens.push(new_token);
  }
  return new_token;
}

export function next_token(str: string, position: number, dfa: DFAState): Token|GroupError|undefined {
  let token = dfa_match(str, position, dfa);
  if (token === undefined || token.symbol.type !== SymbolType.GROUP_START) {
    return token;
  }

  let group_stack: GroupStack = [{
    group: token.symbol.group!,
    start_position: position,
    nested_tokens: []
  }];

  let current_pos = position + token.value.length;
  while (current_pos < str.length) {
    let current_group = group_stack[group_stack.length - 1];
    token = dfa_match(str, current_pos, dfa);
    // Start of new nestable group
    if (token !== undefined &&
        token.symbol.type === SymbolType.GROUP_START &&
        current_group.group.nestable_groups.has(token.symbol.group!.name)) {
      group_stack.push({
        group: token.symbol.group!,
        start_position: current_pos,
        nested_tokens: []
      });
      // new group always starts after spanning token
      current_pos += token.value.length;
      continue;
    }
    // end of group:
    if (token !== undefined &&
        token.symbol.name === current_group.group.end_symbol.name) {
      let group_end = token.position;
      // don't consume newlines
      if (token.symbol.name.toLowerCase() !== "'newline'") {
        group_end += token.value.length;
      }
      let group_token = close_group(group_stack, group_end, str);
      if (group_stack.length === 0) {
        return group_token;
      }
      // After closing continue always after the closing token
      current_pos += token.value.length;
    }
    // For all other tokens, normal increment either charwise or tokenwise
    if (current_group.group.advance_mode === "Char" ||
        token === undefined) {
      current_pos += 1;
    } else {
      current_pos += token.value.length;
    }
  }

  // Should only be here if there are groups
  // but better safe than sorry
  token = undefined;

  // Check for still open groups
  while (group_stack.length > 0) {
    let top = group_stack[group_stack.length - 1];
    if (top.group.ending_mode === "Open") {
      // Open groups can be closed at EOF
      token = close_group(group_stack, str.length, str);
    } else { // Closed groups must be finished
      return {groups: group_stack};
    }
  }

  return token;
}
