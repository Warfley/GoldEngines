# GOLD Engine Design: Lexer

As already mentioned in the introduction, the lexer is implemented using a Deterministic Finite Automata (DFA).

## What is a DFA
A DFA can be seen as a graph of nodes, where each node is called a `state`.
At every point a DFA is in such a `state`, while reading one character at a time.
Each `state` has a number of outgoing `edges` (also called transitions), to other states.
These `edges` have so called labels, which are the symbols that will cause the DFA to switch to this `state`.

For example consider the following DFA:
```javascript
s0 -> s1 label: "a"
s0 -> s2 label: "b"
s1 -> s2 label: "b"
s1 -> s1 label: "a"
```
If the DFA starts in `s0` and the next char in the string is an `a` the DFA switches to state `s1`.
If the next character is a `b` it switches to `s2`, but if it is again an `a`, it stays in `s1`

The DFA can read new characters and switch states until there is no transition left to take.
In this example, after reading a `b`, the automata is in state `s2`, which does not have any outgoing edges.
Therefore if there is any other character afterwards, the DFA is in an error state, meaning from this point on it can nver get back into any meaningful state.

In order for the DFA to match any actual words and produce tokens, some states are declared as final states.
If the DFA reaches such a state it found a valid token.
If we consider `s2` to be a final state in the example above, the DFA would match the following words:
* `b`
* `ab`
* `aab`
* ...

So basically anything that starts with any number of `a` and finishes with a `b`.

A more practical example might bi the following automata:
```javascript
s0 -> s1 label: "1".."9"
s1 -> s1 label: "0".."9"
s1 -> s2 label: "."
s2 -> s3 label: "0".."9"
s3 -> s3 label: "0".."9"

s1 final: "Integer"
s3 final: "Float"
```
This automata can match two kinds of tokens, either `Integers`, which is a digit without "0" followed by an arbitrary number of digits, or a `Float`, which is the same as an `Integer` but followed by a `.` and then a number of digits.

To see how it works, lets consider how it would operate on the text `1234`.
First the DFA starts in `s0`.
With the first char `1` the DFA switches to `s1`.
The next char `2` is a valid edge, which will let the DFA stay in `s1`.
Similar for the next two chars `3` and `4`.
So when we are finished we see that the DFA is in `s1`, which is a final state for Tokens of type `Integer`. so we produce an integer.

When considering the text `3.14`, we have the series of steps `s0->s1->s2->s3->s3`.
As `s3` is a final state for Tokens of type `Float`, this automata tells us that `3.14` is a valid float.

An algorithm for matching a text given a DFA is fairly straight forward to implement:
```javascript
function dfa_match(initial_state, text):
  current_state = initial_state
  for char in text:
    current_state = current_state.edges[char]

  if current_state.is_final:
    return current_state.result
  else:
    return NoMatchFound
```
Simply take each character, check if there is a valid transition, if so take that.
Once the whole text has been passed through the DFA, look if the current state is a final state, if so return the result for that final state.
If it isn't a final state, this includes the error state, the DFA does not have a match.


## Resolving Conflicts: Longest Match and Backtracking
So this is the basics of DFA matching.
The problem now is, this works fine in isolation, when we match one whole string at a time.
But when we try to tokenize a whole string of different tokens, we need some way of deciding when to stop parsing.

Take the example `3.14 is about pi`.
When we start the DFA, already after the first character `3` we reach a final state.
If the Lexer would always print out a new token as soon as a final state was reached, this lexer would return the following tokens:
* `Integer`: `3`
* `Unknown`: `.`
* `Integer`: `1`
* `Integer`: `4`
* `Unknown`: ` `
* ...

But what we actually want is a `Float`: `3.14` and then tokens for the rest of the string.
To resolve this, a so called longest match algorithm is used.
The idea behind this is to try and match as much as possible, and then return the longest match found.
To then continue afterwards so called `Backtracking` is used, so as soon as the DFA enters the error state, or the end of the string is reached, the DFA will output the token of the last final state it encountered and then for the next token, jump back to where this final state was encountered.

So a backtracking longest match DFA implementation could look like this:
```javascript
function dfa_match(initial_state, text, start_position):
  current_state = initial_state
  last_match = None
  for position, char in text from start_position:
    current_state = current_state.edge[char]
    if current_state == ErrorState:
      break
    if current_state.is_final:
      last_match = current_state.result, position

  if last_match == None:
    return NoMatchFound, 1

  return last_match

function match_all(initial_state, text):
  start_position = 0
  tokens = []
  while start_position < text.length:
    next_token, next_position = dfa_match(initial_state, text, start_position)
    tokens.add(next_token)
    start_position = next_position
  return tokens
```
Here the backtracking is performed by storing the last position where a match ended.
As soon as no edge was found, so the DFA is in an error state and it can be sure that there won't be any matches in the future, or if the DFA reached the end of the string, the last (and therefore longest) match will be returned.
When the match was found the next match will be searched from the position right after the previous match.


## Implementation Notes:

### EOF handling
One thing to consider is, that the parser later must be able to recognize if all of the tokens have been read.
This is done by having a final end of file `(EOF)` token be given as the very last lookahead to the parser.
This could be provided at any point, for example it could be simply appended by the `match_all` function above, or it could be handled by the parsing algorithm itself, that checks if this was the last token and if so puts `(EOF)` in the look ahead.
But probably the easiest way is to have simply the lexer return `(EOF)` as the last token itself.


```javascript
function dfa_match(initial_state, text, start_position):
  if start_position >= text.length:
    return EOF_TOKEN, EOF
  current_state = initial_state
  last_match = None
  for position, char in text from start_position:
    current_state = current_state.edge[char]
    if current_state == ErrorState:
      break
    if current_state.is_final:
      last_match = current_state.result, position

  if last_match == None:
    return NoMatchFound, 1

  return last_match

function match_all(initial_state, text):
  start_position = 0
  tokens = []
  // <= instead of < to also capture EOF
  while start_position != EOF:
    next_token, next_position = dfa_match(initial_state, text, start_position)
    tokens.add(next_token)
    start_position = next_position
  return tokens
```
### Backtracking:
The example above assumes that the whole string is already read, and can be accessed at every position easiely.
This makes the implementation of backtracking quite easy, as it is nothing other than resetting the index to the first character after the last match.
But there might be situations where this is not possible.
For example when the input files are very large, the system running the parser does not have enough memory, or the data is read from a constant stream (e.g. from a network) directly.

This makes backtracking a bit more complicated, as now the lexer has to buffer all the characters read, to re-read them in case of backtracking.
An implementation of this could look like this:

```javascript
function dfa_match(initial_state, stream, buffer):
  current_state = initial_state
  backtrack_buffer = ""
  while not stream.eof:
    // Read first from buffer then from stream
    if not buffer.empty:
      next_char = buffer.next
    else:
      next_char = stream.next
    // potential backtrack
    backtrack_buffer.append(next_char)
    // DFA functionality
    current_state = current_state.edge[char]
    if current_state == ErrorState:
      break
    if current_state.is_final:
      // reset backtrack to after this match
      backtrack_buffer = ""
      last_match: current_state.result
  if last_match is None:
    // If no match advance one character
    // so to not be stuck after this error
    retrun NoMatchFound, backtrack_buffer.skip(1)
  return last_match, backtrack_buffer

function match_all(initial_state, stream):
  backtrack_buffer = ""
  tokens = []
  // <= instead of < to also capture EOF
  while start_position != EOF:
    next_token, backtrack_buffer = dfa_match(initial_state, stream, backtrack_buffer)
    tokens.add(next_token)
  return tokens
```

### Token Values
To do semantic analysis on the parsed code, it is important to keep track of the actual values parsed.
For example, something being a number without knowing which number, while being enough information for the parser to parse the language, is pointless for doing any calculations with that number.
For this reason, the lexer should keep track of the actual data read from the string.

Also for creating meaningfull error messages, it can be quite helpful to also remember where the token was read from.
This could be done by annoting the information in the return of the DFA matcher

```javascript
function dfa_match(initial_state, text, start_position):
  current_state = initial_state
  last_match = None
  for position, char in text from start_position:
    current_state = current_state.edge[char]
    if current_state == ErrorState:
      break
    if current_state.is_final:
      last_match = Token(current_state.result, start_position, test.copy(start_position, position)), position

  if last_match == None:
    return NoMatchFound, 1

  return last_match, position
```


## Example:
An example for the real typescript implementation that was developed for the GOLD Parser Tools VSCode extension (at the time of writing) is:
```typescript
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
    let edge = edge_with_label(current_state, chr)
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
```

Which is called by the parser:
```typescript
function parse_string(str: string, dfa: DFAState ...) {
  let current_pos = 0;
  ...
  if (look_ahead === undefined) {
    let token = dfa_match(str, current_pos);
    if (token === undefined) {
      // Lexer error handling
    }
    current_pos = token.position + token.value.length;
    ...
  }
  ...
}
```

What is still missing is the group logic, which is used to parse comments.
This will be addressed later in this documentation.
For now this will be sufficient, and a first lexer, which will be fit for most things except groups, can be fully based just on this logic.


[Next: Building an LR(1) Automata](./parser.md)
