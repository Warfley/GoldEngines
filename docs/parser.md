# GOLD Engine Design: Parser

As already mentioned in the introduction, GOLD engines parse a text with an LALR parser, which is implemented as a stack automata.

## LR Parsing: Stack Automata
Similar to the DFAs described in the chapter above, a stack automata has a state and performs transitions on that state depending on the input.
But unlike the DFA, the state of an stack automata is not just a single number, or node in a graph, but is expressed as the content of the `stack`.
With this stack there are basically two ways to modify the state, one is a so called `shift` operation, where the next token from the input is simply pushed on top of the stack.
The other operation is a so called `reduction`, where the top most items of the stack will be removed and replaced with a new item.
The input on which the action is decided is the so called `look ahead`. This is the next token from the input.
Unlike a DFA the input is not read on every operation, but only on `shift` operations, while it stays uneffected for `reductions`.

To take the example from the introduction:
```xml
<Equality> ::= <Expression> '==' <Expression> (1)

<Expression> ::= <Value> Operator <Value> (2)
              |  <Value> (3)

<Value> ::= Identifier (4)
         |  Constant (5)
```

With the following input
```C
  a == 3 + b
  // Tokenized by lexer to
  'Identifier' 'Equals' 'Constant' 'Operator' 'Identifier'
```

The parser always starts with an empty stack (`[]`) and the look ahead of the first symbol (`'Identifier'`).
As the stack is empty, no reduction can take place, so the automata must perform a shift operation.
Now the look ahead is put on the stack (`['Identifier']`), and a new symbol is read as look ahead (`'Equals'`)

Now the automata looks at it's stack and checks what reductions are possible.
On the top of the stack there is an `Identifier`, therefore rule (4) is applicable.
As no other reduction involves an `Identifer`, this is the only option and the automata performs this operation.
The look ahead stays uneffected (`'Equals'`) but the `'Identifier'` is consumed from the stack and in it's place a new `<Value>` is pushed.

In the next step the automata again checks which reductions would be possible with it's current stack (`[<Value>]`).
There are two rules which are applicable with a `<Value>` symbol, rule (2) and rule (3).
As there is no single option, the automata needs to decide if it "waits" for the rest of rule (2), or if it already performs the reduction of rule (3).
For this the automata looks at the look ahead, and sees that an `'Equals'` is not part of rule (2), therefore rule (3) is the only possible rule, and the automata performs this operation, and replaces the `<Value>` on the stack with an `<Expression>`.

In the next step the automata recognizes that the only rule applicable is rule (1), but this requires 3 symbols on the stack (`<Expression>`, `'Equals'`, `<Expression>`), but has only 1, so a shift operation is performed.
Similar in the next step, the automata sees that for rule (1) still one symbol is missing, so another shift is performed.

Now the stack is `[<Expression>, 'Equals', 'Constant']` and the look ahead is `'Operator'`.
When looking at the stack, we are in the same situation as in the beginning, where only rule (5) can be applied, the reduction of a `Constant` to a `<Value>`.
Now the automata is again in the situation on what to do with `<Value>` as again rule (2) or rule (3) apply.
But this time, when looking at the look ahead, it contains an `'Operator'`, exactly what is needed for continuing rule (2), so the automata decides to shift and try to continue on rule (2).

Then after another shift operation and again reducing a `Identifier` to a `<Value>`, the stack now is `[<Expression>, 'Equals', <Value>, 'Operator', <Value>`.
As the last symbol was shifted, the look ahead now is the end of file `(EOF)`, meaning only reductions can be performed from now on.

The automata looks at the stack and sees that the top 3 elements (`<Expression>`, `'Operator'`, `<Expression>`) are what is required for rule (2), so they are replaced with an `<Expression>`.
After this, the final reduction can be applied consuming all of the remaining stack (`<Expression>, 'Equals', <Expression>`) and producing the start symbol `<Equality>`.

As the start symbol was reached, and there are no more symbols to be read, the automata finishes successfully.
This is called that the parser `accepted` the input.
If at any point, there would be no rule applicable, the automata would have been in an error state, meaning the file could not be parsed.

Here is a short visualization of this parsing:
```xml
Look Ahead |  Identifier  |        |    Equals    |  Reduce  |    Equals    |
           +--------------+-Shift->+--------------+-<Value>->+--------------+
     Stack |              |        |  Identifier  |          |   <Value>    |

::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

    Reduce     |    Equals    |        |   Constant   |        |   Operator   |
-<Expression>->+--------------+-Shift->+--------------+-Shift->+--------------+
               |    Equals    |        |   Constant   |        |   Constant   |
               | <Expression> |        | <Expression> |        |    Equals    |
                                                               | <Expresison> |

::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

  Reduce  |   Operator   |        |  Identifier  |        |    (EOF)     |
-<Value>->+--------------+-Shift->+--------------+-Shift->+--------------+
          |   <Value>    |        |   Operator   |        |  Identifier  |
          |    Equals    |        |   <Value>    |        |   Operator   |
          | <Expresison> |        |    Equals    |        |   <Value>    |
                                  | <Expresison> |        |    Equals    |
                                                          | <Expresison> |

::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

  Reduce  |    (EOF)     |    Reduce     |    (EOF)     |   Reduce    |    (EOF)     |
-<Value>->+--------------+-<Expression>->+--------------+-<Equality>->+--------------+
          |   <Value>    |               | <Expression> |             | <Assignment> |
          |   Operator   |               |    Equals    |
          |   <Value>    |               | <Expression> |
          |    Equals    |
          | <Expresison> |
```

The basic algorithm above would be:
```javascript
function lr_step(stack, look_ahead):
  options = applicable_rules(stack)

  for option in options:
    if option.followed_by(look_ahead):
      selected_option = option
      break

  if selected_option is None:
    return ParsingError
  if selected_option is rule:
    // Take the options to be replaced
    stack.pop(rule.consumes)
    // put new symbol on the stack
    stack.push(rule.produces)
    return Reduction
  if selected_option is Accepted:
    // No more options because start symbol was read
    return Accepted
  else: // Shift
    stack.push(look_ahead)
    return Shift
```

## LALR Parsing
While being quite simple, it is quite computational expensive, as for every step, all of the rules must be checked if they are applicable with the current contents of the stack.
To reduce this searching overhead, explicit `states` are introduced.
Here every valid stack configuration will be represented by a state, similar to the states in a DFA.
The rules and actions are then encoded as `transitions` from one state to another, labeld with the `look ahead` that results in the automata taking this transition, and annotated with the `action` the parser would need to perform when taking this transition.
The unlike before, where symbols where pushed on the stack, now the state is then pushed to the top of the stack, and when a `shift` operation is performed, the next state will be pushed on top.
On a `reduction`, where previously the top most symbols where taken from the stack and replaced by the new symbol, now the top most states are removed and replaced by a new state.

One caveat is that the next state after a reduction is not just dependent on the reduction that was performed, but also on what was the previous state on top of which the newly reduced symbol is places.
For this reason, each state also has a so called `goto` table, which contains the next states after a reduction was performed.

This simplifies the algorithm to
```javascript
function lr_step(stack, look_ahead):
  current_state = stack.top
  transition = current_state.transitions[look_ahead]
  if transition is None:
    return ParserError
  if transition is Shift:
    stack.push(transition.target)
    return Shift
  if transition is Reduction:
    stack.pop(transition.consumes)
    // look up goto table for the current reduction
    next_state = stack.top.goto[transition.produces]
    stack.push(next_state)
    return Reduction
  if transition is Accepted:
    return Accepted
```

But as you might imagine, creating a state for every valid stack configuration can lead to a massive number of stacks and therefore a massive memory consumption.
For this reason LALR parsing was developed, which takes the idea of creating different states for the different stack configurations, but reduces the number of states, by combining similar states.
This combination actually makes LALR parsers not quite as powerful as LR parsers, and there are cases where an LR parser would be able to parse a language that an LR parser can't.
But these are quite theoretical edge cases, pretty much all modern languages can be parsed by an LALR parser.

The actual algorithm for creating these states, either for a full blown LR parser, or the reduced set for the LALR parser, is something that is completely taken care of by the GOLD builder.
All our engine needs to implement is this quite simple algorithms depicted above.

## Implementation Notes

### Combined Transition and GOTO Table
The example above created the goto and transitions table as seprate tables.
As goto and shift have a common functionality, that is the decision for the next state to move to, they can be combined.
This works because while both tables map symbols onto actions, the transition table maps only `TERMINAl` symbols (i.e. the tokens the lexer produces), the goto table maps the results of reductions, which are always `NON-TERMINAL` symbols.
Therefore there can't be any collisions between these two tables.

The combination of those two tables can make sense as it can unify the handling of the different actions.
Some parsers, for example the VB one by Devin Cook, handle the goto table this way

### Parse Tree Generation
The algorithm described above does only parse the input and output success or error. Of course to be useful, it must collect some information about the parsed source code.
There are a few options for this. The first option is for the algorithm to construct a parse tree during execution.
For this not just the current state is placed on the stack, but also the subtree that was parsed so far by this state.
When performing a reduction, the new parse tree can then be generated by creating a new tree node, with the poped subtrees from the consumed stack objects as children.

For example:
```javascript
function lr_step(stack, look_ahead):
  current_tree, current_state = stack.top
  transition = current_state.transitions[look_ahead]
  if transition is None:
    return ParserError
  if transition is Shift:
    terminal_tree = tree_leaf(look_ahead);
    stack.push(terminal_tree, transition.target)
    return Shift
  if transition is Reduction:
    subtrees, _ = stack.pop(transition.consumes)
    // Reverse because the stack pops them in reverse order
    // of being pushed on
    reduction_tree = tree(transition.produces, reverse(subtrees))
    // look up goto table for the current reduction
    next_state = stack.top.goto[transition.produces]
    stack.push(reduction_tree, next_state)
    return Reduction
  if transition is Accepted:
    return current_tree
```

### Parse Tree Reduction
Grammars often have rules which are only there because it makes sense in the grammar, but are not useful for any analysis afterwards.
Taking the parse tree generated by our example from the beginning:

```xml
<Equality>
+--<Expression>
|  +--<Value>
|     +--Identifier
+--Equals
+--<Expression>
   +--<Value>
   |  +--Constant
   +--Operator
   +--<Value>
      +--Identifier
```

The `<Value>` symbols are just a proxy for allwoing both `Constants` and `Identifier`, but there is little practical use for analysis afterwards.
Similar lists in grammars are described recursively, for example:
```xml
<Statements> ::= <Statement>; <Statements>
              |
```
This will then result in the following parse tree
```xml
<Statements>
+--<Statement>
|  ...
+--<Statements>
   +--<Statement>
   |  ...
   +--<Statements>
...
```

For later analysis, it can be of more value to reduce these "ladder" lists to a flat list:
```xml
<Statements>
+--<Statement>
|  ...
+--<Statement>
|  ...
+--...
```

Both of these conditions, can be algorithmically detected while building the tree, and those additional nodes can be ignored.
Of course this simplification can also be done afterwards, so there is no need to build this into your engine.


### External Handling
Another solution for getting useful information from the parsing is to not generate the tree directly, but allow for extension points, e.g. in form of events, to be fired when a reduction happens.
This way the user of the engine could build their own tree, as they see fit.
For this solution, the parser should still keep track of the kinds of symbols poped on the stack, but does not need to build the tree:

For example:
```javascript
function lr_step(stack, look_ahead, on_reduce):
  current_symbol, current_state = stack.top
  transition = current_state.transitions[look_ahead]
  if transition is None:
    return ParserError
  if transition is Shift:
    stack.push(look_ahead, transition.target)
    return Shift
  if transition is Reduction:
    consumed, _ = stack.pop(transition.consumes)
    // call event
    // Reverse because the stack pops them in reverse order
    // of being pushed on
    on_reduce(transition.produces, reverse(consumed))
    next_state = stack.top.goto[transition.produces]
    stack.push(reduction_tree, next_state)
    return Reduction
  if transition is Accepted:
    return current_symbol, current_tree
```
Now the user can just add some functionality to be executed in `on_reduce` to handle the parsing results on their own.

## Combination of Lexer and Parser

With these two algorithms we can now build the core of our engine.
This core calls the lexer to read the look ahead, then executes the parser, and on shift, produces a new token.

```javascript
function parse(text, lalr_initial_state, dfa_initial_state):
  stack = [lalr_initial_state]
  match_pos = 0
  while not finished:
    if look_ahead is None:
      look_ahead, match_pos = dfa_match(dfa_initial_state, text, match_pos)
      if look_ahead == NoMatchFound:
        return LexerError
    parser_step = lalr_step(stack, look_ahead)
    if parser_step == ParserError:
      return SyntaxError
    if parser_step == Accept:
      return Accept
    if parser_step == Shift:
      // look_ahead was consumed, so reset
      look_ahead = None
```

And thats it.
Of course any real implementation needs some additional functionality for extracting information from the parsing, but at it's core, this is the complete algorithm required for building a GOLD engine.

Now it's just on how to construct the DFA and LALR automatas from the GOLD Grammar Table format, which will be addressed in the next chapter.

## Example
An example for the real typescript implementation that was developed for the GOLD Parser Tools VSCode extension (at the time of writing) is:

```typescript
function LALR_step(look_ahead: Token, stack: LRStack): LRStepResult {
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
```

With the lexer to parser combination being (except for some special handling that was ommited as it will be discussed later)
```typescript
export async function parse_string(str: string, dfa: DFAState, lalr: LRState,
                             on_token?: DFAEvent,
                             on_reduce?: LREvent,
                             on_shift?: LREvent,
                             ...args: any[]
                            ): Promise<LRParseTreeNode|LexerError|GroupError|ParserError> {
  let look_ahead: Token|undefined = undefined;
  let current_pos = 0;
  let stack = LALR_setup(lalr);

  while (current_pos <= str.length || look_ahead !== undefined) {
    if (look_ahead === undefined) {
      // Lex next token
      let look_ahead = next_token(str, current_pos, dfa);
      if (look_ahead === undefined) { // Lexer Error
        return {position: current_pos};
      }
      ...
      current_pos += look_ahead.value.length;
      ...
      // call event
      if (on_token !== undefined) {
        await on_token(look_ahead, ...args);
      }
      continue;
    } // else

    let current_state = stack[stack.length-1].current_state;
    let step = LALR_step(look_ahead, stack);
    switch (step) {
      case LRStepResult.ACCEPT:
        return stack.pop()!.parse_tree;

      case LRStepResult.ERROR:
        return { // Parser Error
          last_token: look_ahead,
          stack: stack
        };

        case LRStepResult.REDUCE:
          if (on_reduce !== undefined) {
            await on_reduce(current_state, look_ahead, stack, ...args);
          }
          break;

        case LRStepResult.SHIFT:
          if (on_shift !== undefined) {
            await on_shift(current_state, look_ahead, stack, ...args);
          }
          look_ahead = undefined;
          break;
    }
  }
  return { // Unexpected EOF Error
    stack: stack,
    last_token: "(EOF)"
  };
}
```

[Next: The GOLD Grammar Table format](./grammars.md)
