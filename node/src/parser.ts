/* eslint-disable @typescript-eslint/naming-convention */

import { DFAState, GroupError, MatchGroup, next_token, Token } from "./lexer";

export enum LRActionType {
  SHIFT = 1,
  REDUCE = 2,
  GOTO = 3,
  ACCEPT = 4
}

export enum SymbolType {
  NON_TERMINAL = 0,
  TERMINAL = 1,
  SKIP_SYMBOLS = 2, // Whitespaces, newlines, etc.
  EOF = 3,
  GROUP_START = 4,
  GROUP_END = 5,
  COMMENT_LINE = 6,
  ERROR = 7
}

export interface ParserSymbol {
  type: SymbolType;
  name: string;
  group?: MatchGroup;
}

export interface ParserRule {
  index: number;
  produces: ParserSymbol;
  consumes: Array<ParserSymbol>;
}

export interface LRAction {
  type: LRActionType.REDUCE|LRActionType.SHIFT|LRActionType.GOTO,
  target: LRState|ParserRule;
}

export interface LRState {
  index: number;
  edges: Map<string, LRAction|"Accept">;
  goto: Map<string, LRAction>;
}

export interface LRParseTreeNode {
  symbol: ParserSymbol;
  children: Token|Array<LRParseTreeNode>;
}

interface LRStackItem {
  parse_tree: LRParseTreeNode;
  current_state: LRState;
}

type LRStack = Array<LRStackItem>;

enum LRStepResult { ACCEPT, SHIFT, REDUCE, ERROR }

function lalr_step(look_ahead: Token, stack: LRStack): LRStepResult {
  let current_state = stack[stack.length-1].current_state;
  let transition = current_state.edges.get(look_ahead.symbol.name);

  if (transition === undefined) {
    return LRStepResult.ERROR;
  }
  if (transition === "Accept") {
    return LRStepResult.ACCEPT;
  }
  if (transition.type === LRActionType.SHIFT) {
    stack.push({
      current_state: transition.target as LRState,
      parse_tree: {
        symbol: look_ahead.symbol,
        children: look_ahead
      }
    });
    return LRStepResult.SHIFT;
  } // else if (action.type === LRActionType.REDUCE)

  // Reduction
  let rule = transition.target as ParserRule;
  if (stack.length < rule.consumes.length) {
    throw new Error("State mismatch");
  }
  let new_symbol = rule.produces;
  let consumes = rule.consumes.map(() => stack.pop()!.parse_tree).reverse();
  let top_state = stack[stack.length-1].current_state;
  let next_state = top_state.goto.get(rule.produces.name);

  if (next_state === undefined) {
    throw new Error("GOTO not found for Symbol");
  }

  stack.push({
    parse_tree: {
      symbol: new_symbol,
      children: consumes
    },
    current_state: next_state.target as LRState
  });

  return LRStepResult.REDUCE;
}

function lalr_setup(initial_state: LRState): LRStack {
  return [{
    current_state: initial_state,
    parse_tree: {
      symbol: {
        name: "INITIAL_STATE",
        type: SymbolType.ERROR
      },
      children: []
    }
  }];
}

interface LexerError {
  position: number;
}

interface ParserError {
  last_token: "(EOF)"|Token;
  stack: LRStack;
}

type DFAEvent = (token: Token, ...args: any[]) => Promise<void>;
type LREvent = (orig_state: LRState, look_ahead: Token, stack: ReadonlyArray<LRStackItem>, ...args: any[]) => Promise<void>;

export async function parse_string(str: string, dfa: DFAState, lalr: LRState,
                             on_token?: DFAEvent,
                             on_reduce?: LREvent,
                             on_shift?: LREvent,
                             ...args: any[]
                            ): Promise<LRParseTreeNode|LexerError|GroupError|ParserError> {
  let look_ahead: Token|undefined = undefined;
  let current_pos = 0;
  let stack = lalr_setup(lalr);

  while (current_pos <= str.length || look_ahead !== undefined) {
    if (look_ahead === undefined) {
      // Lex next token
      let tok = next_token(str, current_pos, dfa);
      if (tok === undefined) {
        return {position: current_pos};
      }
      if ("groups" in tok) {
        return tok;
      }
      current_pos += tok.value.length;
      if (tok.symbol.type === SymbolType.SKIP_SYMBOLS) {
        continue;
      }
      look_ahead = tok;
      if (on_token !== undefined) {
        await on_token(tok, ...args);
      }
      continue;
    } // else

    let current_state = stack[stack.length-1].current_state;
    let step = lalr_step(look_ahead, stack);
    switch (step) {
      case LRStepResult.ACCEPT:
        return stack.pop()!.parse_tree;

      case LRStepResult.ERROR:
        return {
          last_token: look_ahead,
          stack: stack
        };

        case LRStepResult.REDUCE:
          if (on_reduce !== undefined) {
            await on_reduce(current_state, look_ahead, stack, ...args);
          }
          break;

        case LRStepResult.SHIFT:
          if (look_ahead.symbol.type === SymbolType.EOF) {
            throw new Error("Shifting EOF should never happen");
          }
          if (on_shift !== undefined) {
            await on_shift(current_state, look_ahead, stack, ...args);
          }
          look_ahead = undefined;
          break;
    }
  }
  return {
    stack: stack,
    last_token: "(EOF)"
  };
}