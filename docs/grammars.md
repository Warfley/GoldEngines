# GOLD Engine Design: Grammar Tables

To run the lexing and parsing algorithms described in tha last chapter, the automatas must be built from the GOLD grammar tables.
The grammar tables can be compiled in two formats, format 1.0 usually indicated by the file extension `.cgt`, and format 5.0 usually indicated by the file extension `.egt`.
Both formats share a lot of features in common, so this document will cover both simultaniously and mention when a feature is just available in one or the other.

It is also not that difficult to create an engine that supports both formats simultaniously.
This will also be discussed where appropriate

## Basic Datatypes
The grammar tables are represented by a binary format, which consists of 4 basic types, which will shortly be explained here.

### Integers
Numbers are represented by an `unsigned 16 bit integer` in `little endian`. This means a number between 0 and 65535 represented by two bytes (16 bit), where the first byte is the least significant and the second byte is the most significant (little endian).

Most languages should have already support for reading those numbers. As most systems in use today are actually `little endian` this might just be called `uint16`.
If not it can be simply parsed by reading each byte individually and combining them using arithmetic operations:
```javascript
function read_uin16_le(stream):
  lsb = stream.read_byte()
  msb = stream.read_byte()
  return lsb + (msb * 256)
```

### Strings
Texts or sequences of characters are written as so called `widestrings` (sometimes also called `unicode strings`). Those are `UTF-16 LE` encoded strings consisting of `widechars` which are characters that are two bytes long and represent codepoints encoded as unsinged 16 bit little endian integers.
Most programming languages today use `UTF-8` strings, but often provide capabilities for translating between `UTF-16 LE` and `UTF-8`.

Strings are `0x0000` terminated, meaning after the end of the text there will be a `0x0000` widechar, or 2 bytes that contain the numeric value `0`.
A simple algorithm for reading those might look like this:
```javascript
function read_string(stream):
  result = widestring("")
  while not stream.eof:
    next_char = read_uint16_le(stream)
    if next_char = 0x0000:
      return utf16_to_utf8(result)
    result += widechar(next_char)
  return StringNotTerminated
```

### Booleans
Boolean values (`true` or `false`) are encoded as one byte that can either have the numeric value `0` representing false or `1` representing true.
Reading is therefore simply:
```javascript
function read_bool(stream):
  return stream.read_byte() == 1
```

### Chars
The last basic datatypes in the file format are called `byte` by the official documentation.
Those are one byte numeric values.
But as these bytes in the dataformat always represent ascii characters, this document will call them `chars`, as reading a byte as an ascii character is directly implementable with most languages, and to avoid confusion as the term `byte` is also used to describe raw data (as in the descriptions above).

Some languages like javascript do not have a direct char datatype, but handle only strings, but still provide functionality to convert between charcodes and 1 character strings.
This could look like this
```javascript
function read_char(stream):
  char_code = stream.read_byte()
  return char_from_char_code(char_code)
```

## Grammar Table Format

The grammar table consists basically only of two things, a magic string in the beginning followed by a series of data records.
The magic string is to make sure the file at hand is a GOLD grammar table, and also contains the version number of the grammar table, which can be used to decide how to parse it.

The format therefore looks like this:
```
+-------------------------+
| GOLD Parser Tables/vX.0 |
+-------------------------+
|         Record 0        |
+-------------------------+
|         Record 1        |
+-------------------------+
|           ...           |
```
The magic string is a 0x0000 terminated widestring as explained above.

Therefore the header can be read simply parsing it with a very simple regex:
```javascript
function read_header(stream):
  magic = read_string(stream)
  if regex_match(magic, "GOLD Parser Tables\/v(1|5).0"):
    if regex_group(1) == "1"
      return Version1
    else:
      return Version5
  return InvalidHeader
```

### Records
The records then describe the data that is used to construct the automatas.
All records have generally the same format, as they consist of a number of fields.

A field is always one char indicating the type of the field, followed by the data in one of the formats described above:
| Type Name | ASCII Char | Datatype   |
|-----------|------------|------------|
| Boolean   | 'B'        | Boolean    |
| Int       | 'I'        | UInt 16 LE |
| String    | 'S'        | Widestring |
| Byte      | 'b'        | ASCII Char |
| Multi     | 'M'        | UInt 16 LE |
| Empty     | 'E'        | -          |

Most of these fields directly correspond to the basic types discussed above, the only two special ones are `Empty`, which is for fields that are reserved for future use (RFU), and are not followed by any data, and `Multi`, which is basically just an Int, but has a special semantic purpose.

Reading such a field is straight forward, just read the type indicating char and then the value:
```javascript
function read_int_field(stream):
  type = read_char(stream)
  if type != 'I':
    return NotAnInt
  return read_uint16_le(stream)
```

Some records might have fields that are not of use for specific implementations, so it can be useful to have a function to just skip a field, no matter the type.
```javascript
function skip_field(stream):
  type = read_char(stream)
  if type == 'B':
    read_boolean(stream)
  else if type == 'I':
    read_uint16_le(stream)
  else if type == 'S':
    read_string(stream)
  else if type == 'E':
    // Do nothing
  else:
    return UnknownField
```

Every record begins with a `Multi` field, which indicates how many fields this record will have (excluding the Multi field itself).
This information is required as some fields can have dynamic length, so the number read can be used to determine how much data is left to read.
It can also be used to perform some error checks to see if all the fields were read.

It might be useful to be able to skip certain records, in this case the number read from the `Multi` field can be used to skip the number of fields in the record:
```javascript
function skip_record(stream):
  count = read_multi(stream)
  for count times:
    skip_field(stream)
```

The next field is a Byte, whose char value indicates what type of record it is.
The following fields are then dependent on the type of the record.

## Record Types
There are in total 12 different record types over both v1 and v5:
| Record Type    | ASCII Char | v1 | v5 |
|----------------|------------|----|----|
| Parameter      | 'P'        | x  |    |
| Property       | 'p'        |    | x  |
| Counts (v1)    | 'T'        | x  |    |
| Counts (v5)    | 't'        |    | x  |
| Initial States | 'I'        | x  | x  |
| Char Set       | 'C'        | x  |    |
| Char Ranges    | 'c'        |    | x  |
| Symbol         | 'S'        | x  | x  |
| DFA State      | 'D'        | x  | x  |
| LR State       | 'L'        | x  | x  |
| Rule           | 'R'        | x  | x  |
| Group          | 'g'        |    | x  |

### Parameter
The very first record in the Grammar Table is usually either a `Parameter` record for a version 1.0 grammar or a number of `Property` records.

This contains the Parameter of the grammar, such as "Author", "Case Sensetive" and co.

Version 1.0 only allowed a strict set of parameters, which where alwasy encoded in a strict order and could be read field by field from the record:
| Parameter      | Datatype |
|----------------|----------|
| Name           | String   |
| Version        | String   |
| Author         | String   |
| About          | String   |
| Case Sensitive | Boolean  |
| Start Symbol   | Int      |

Reading this record is therefore straight forward:
```javascript
function read_parameter(stream):
  params = Map()
  params["Name"] = read_string_field(stream)
  params["Version"] = read_string_field(stream)
  params["Author"] = read_string_field(stream)
  params["About"] = read_string_field(stream)
  params["Case Sensitive"] = read_bool_field(stream)
  params["Start Symbol"] = read_int_field(stream)

  return params
```

### Property
In version 5.0 the parameter handing is more flexible and allows for adding arbitrary parameters to the grammar.
To accomplish this, rather than having one record containing a fixed set of parameters, there are now multiple property records each containing just the name of the property and the value as `String` field.

The structure record is:
```
+-------+------+-------+
| Index | Name | Value |
+-------+------+-------+
```
The index could be used for some error checking, or to map the properties onto an array, but is most likely of no use.
Therefore the reading of the property would look like this:
```javascript
function read_property(stream, params):
  skip_field(stream) // Index
  name = read_string_field(stream)
  value = read_string_field(stream)
  params[name] = value
```

### Counts
The second record encountered is the Counts record, which is mostly the same for version 1.0 and 5.0, except that version 5.0 adds another field.

The counts contain a fixed set of `Int` fields, indicating how many other records will be encountered.
This allows the programmer to encode error checking, but also to pre-allocate the arrays for each of the record types.
This can be useful for some languages, but as the records are always in order, there is no strict need for it.

The fields are all Int fields and are:
* Symbol Count
* Char Set/Char Ranges Count
* Rule Count
* DFA State Count
* LR State Count
* Group Count (v5 Only)

If pre-allocation should be done, this can look like this:
```javascript
  symbol_count = read_int_field(stream);
  charset_count = read_int_field(stream);
  rule_count = read_int_field(stream);
  dfa_state_count = read_int_field(stream);
  lr_state_count = read_int_field(stream);

  symbols = SymbolArray(symbol_count);
  charsets = CharSetArray(charset_count);
  rules = RuleArray(reduction_count);
  dfa_states = DFAStateArray(dfa_state_count);
  lr_states = LRStateArray(lr_state_count);

  if version == v5:
    group_count = read_int_field(stream);
    parsed_groups = GroupArray(group_count)
```

Otherwise it can just be skipped.

All the other records contain an `index` field as the very first field.
When preallocating the arrays this can be used to write the read information to that field.
When not preallocating the arrays, this can be used for error checking.

In the following we will assume non preallocated arrays for simplicity:
```javascript
  for field_count - 1 times: // -1 because of the group type field
    skip_field(stream)
```

### Initial States
This record contains only two `Int` fields, the index of the initial DFA state, and the index of the initial LR state.

```javascript
function read_initial_states(stream):
  dfa_initial_state = read_int_field(stream)
  lr_initial_state = read_int_field(stream)
  return dfa_initial_state, lr_initial_state
```

### Char Set
For constructing the DFA, the edges require labels.
These labels tell the DFA which characters cause this edge to be taken.
In version 1.0, those are simple character sets, meaning just a list of all the characters that cause this edge to be taken.
This set of characters is represented by a `String` field, where each character of the string is a member of the set:
```javascript
function read_char_set(stream, next_index):
  result = Set()
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  chars = read_string_field(stream)
  for char in chars:
    result.add(char)

  return result
```
For the DFA to check if a character is in that edge, it just needs to check if the character is contained within the charset.

### Char Ranges
Version 5.0 changed the DFA edge labeling a bit. Rather than using a set containing all the possible chars, now contains a set of ranges of characters.
So for example, instead of the previous charset being "ABCD", it would now just contain the range ['A'..'D']

For this the new char range record is a bit more complicated:
```
+-------------------------------------+
| Index | Codepage | Count | Reserved |
+-------------------------------------+
|               Range 0               |
+-------------------------------------+
|               Range 1               |
|                 ...                 |
|           Range Count - 1           |
+-------------------------------------+
```
Where each of the ranges consists of 2 `Int` fields, representing the numeric value for the start and end character of the range within the unicode codepage of this record.

Which could be read like this:
```javascript
function read_char_ranges(stream, next_index):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  code_page = read_int_field(stream)
  count = read_int_field(stream)
  skip_field(stream) // RFU
  ranges = []

  for count times:
    range_start = read_int_field(stream)
    range_end = read_int_field(stream)
    ranges.push(range_start, range_end)

  return CharRanges(code_page, ranges)
```

For the DFA to then check wheter a char is covered by the code ranges, it must conver the char to the codepage of this range, and then check if the character is between start and end:
```javascript
function char_in_ranges(char, char_ranges):
  code_point = utf_16_encode(char, char_ranges.codepage)
  for range in char_ranges.ranges:
    if code_point >= range.start &&
       code_point <= range.end:
      return true
  return false
```

### Symbols
Symbols are what the parser operates on.

They are encoded as an index, a `String` name, and an `Int` type:
```
+-------+------+------+
| Index | Name | Type |
+-------+------+------+
```

There are 7 types of symbols:
| Type Name | Field Value | Description |
|-----------|-------------|-------------|
| Non Terminal | 0 | Parsing tree nodes generated by the parser, equivalent to the non terminals in the grammar rules |
| Terminal | 1 | Symbols produced by the lexer used for input by the parser |
| Skippable | 2 | Symbols produced by the lexer that can be ignored for the parser (Whitespaces, Newlines, comments, etc.) |
| EOF | 3 | End Of File token produced by the lexer to indicate no more tokens can be shifted |
| Group Start | 4 | This symbol starts a lexical group (e.g. block comments) |
| Group End | 5 | This symbols indicates the end of a lexical group |
| Comment Line | 6 | Only in v1, this symbol indicates a line comment |

Reading the symbol is therefore just:
```javascript
function read_symbol(stream, next_index):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  name = read_string_field(stream)
  type = read_int_field(stream)

  return Symbol(name, type)
```

### DFA States
To construct the DFA, the DFA State records contain all the information about the state and all the outgoing transitions.
For this it references the aforementioned character sets or ranges, and symbols, as well as to other DFA States.
These references are `Int` fields, containing the index of those records.
If the records are read in order and pushed onto an array, they should correspond to the respective array indices.

The format for the DFA State Record is:
```
+--------------------------------------+
| Index | Is Final | Result | Reserved |
+--------------------------------------+
|                Edge 1                |
+--------------------------------------+
|                Edge 2                |
+--------------------------------------+
|                  ...                 |
```

With each edge consisting of the char set and the target state:
```
+---------+--------------+----------+
| Charset | Target State | Reserved |
+---------+--------------+----------+
```

The number of edges can be computed from the total number of for the record:
```javascript
function read_dfa_state(stream, next_index, num_fields):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  is_final = read_bool_field(stream)
  final_result = read_int_field(stream)
  skip_field(stream) // RFU

  state = DFAState(index, is_final, final_result)
  edge_fields = num_fields - 5 // 4 fields read here + record type field
  num_endges = edge_fields / 3 // 3 fields per edge
  for num_edges times:
    label_chars = read_int_field(stream)
    target_state = read_int_field(stream)
    skip_field(stream) // RFU
    state.edges.push(label_chars, target_state)

  return state
```

### LR States
LR States are similarly encoded as DFA States just without the final state and result information:
```
+------------------+
| Index | Reserved |
+------------------+
|      Edge 1      |
+------------------+
|      Edge 2      |
+------------------+
|       ...        |
```

For the LR states the edges are encoded as actions, which have the look ahead symbol as their label that triggers this action, the type of action and a target whose meaning is action dependent:
| Action | Int Value | Target Function | Symbol Type |
|--------|-----------|-----------------|-------------|
| Shift  | 1         | Next LR State   | Look Ahead  |
| Reduce | 2         | Applicable Rule Index | Look Ahead |
| Goto   | 3         | Next LR State | Previously reduced Non Terminal |
| Accept | 4         | -               | Look Ahead |

As can be seen the target is ususally the LR state to switch to for either a shift or the goto table.
But in the case of a reduction it references the rule which should be applied.

Parsing could therefore look like this:
```javascript
function read_lr_state(stream, next_index, num_fields):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  skip_field(stream) // RFU

  state = LRState(index)
  edge_fields = num_fields - 3 // 2 fields read here + record type field
  num_endges = edge_fields / 4 // 4 fields per edge
  for num_edges times:
    look_ahead_symbol = read_int_field(stream)
    action_type = read_int_field(stream)
    target_value = read_int_field(stream)
    skip_field(stream) // RFU

    if action_type == GOTO:
      state.goto[look_ahead_symbol] = target_value
    else if action_type == Accept:
      state.edges[look_ahead] = Accept
    else if action_type == REDUCE:
      state.edges[look_ahead] = Rule(target_value)
    else if action_type == SHIFT:
      state.edges[look_ahead] = NextState(target_value)
    else
      return UnknownActionType

  return state
```

### Rules
The rules describe the reduction rules from the grammar.
Each rule has a symbol that it produces (on the left side of the ::= in the grammar), and a number of symbols it consumes (on the left side of the ::= in the grammar)
Therefore the structure of the record is quite simple:
```
+-----------+-----------+-----+
| Index     | Produces  | RFU |
+-----------+-----------+-----+
| Consume 1 | Consume 2 | ... |
+-----------+-----------+-----+
```

And could be read like this:
```javascript
function read_rule(stream, next_index, num_fields):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  produce_symbol = read_int_field(stream)
  skip_field(stream) // RFU

  rule = Rule(index, produce_symbol)
  num_consumes = num_fields - 4 // 3 fields read here + record type field
  for num_edges times:
    consume_symbol = read_int_field(stream)
    rule.consumes.push(consume_symbol)

  return rule
```

### Groups
Lexical groups are used to parse text that is encapsulated by symbols.
An example of which are block comments, where the start symbol is the comment start and the end symbol is the comment end.
The whole encapsulated text will then be parsed as a single symbol.
These will be further discussed in the next chapter, for now we will just consider the structure:
```
+-------------+----------+--------------+
| Index       | Name     | Symbol       |
+-------------+----------+--------------+
| Start       | End      | Advnace Mode |
+-------------+----------+--------------+
| Ending Mode | Reserved | Count        |
+-------------+----------+--------------+
| Nested 1    | Nested 2...Nested Count |
+-------------+-------------------------+
```

Where Advace and Ending modes are both `Int` with the following meaning:
| Mode    | 0          | 1                |
|---------|------------|------------------|
| Advance | Tokenwise  | Charwise         |
| Ending  | Open Ended | Requires Closing |

The meaning of which will be described in the next chapter.

The list of Nested are all `Int` fields, containing the indices of other groups that can be nested within this group.

Groups could therefore be parsed like this:
```javascript
function read_group(stream, next_index):
  index = read_int_filed(stream)
  if index != next_index:
    return IndexOutOfOrder

  name = read_string_field(stream)
  symbol = read_int_field(stream)
  start_symbol = read_int_field(stream)
  end_symbol = read_int_field(stream)
  advance_mode = read_int_field(stream)
  ending_mode = read_int_field(stream)
  skip_field(stream) // RFU
  nesting_count = read_int_field(stream)

  result = Group(name, symbol,
                 start_symbol, end_symbol,
                 advance_mode, ending_mode)

  for nesting_count times:
    group_index = read_int_field(stream)
    result.nestables.push(group_index)

  return Symbol(name, type)
```

## File Reading Algorithm
We therefore get a file reading algorithm that looks like this:
```javascript
function read_grammar(stream):
  version = parse_header(stream)
  if version == InvalidHeader:
    return InvalidGrammar

  while not stream.eof():
    field_count = read_multi(stream)
    record_type = read_char(stream)
    if record_type == Parameter:
      read_parameter(stream, params)
    else if record_type == Property:
      read_property(stream, params)
    else if record_type == CountsV1 Or CountsV2:
      for field_count - 1 times:
        skip_field(stream)
    else if record_type == InitialStates:
      dfa_initial_state, lr_initial_state = parse_initial_states(stream)
    else if record_type == CharSet:
      charsets.push(read_charset(stream, charsets.length))
    else if record_type == CharRanges:
      charranges.push(read_charranges(stream, charranges.length))
    else if record_type == Symbol:
      symbols.push(read_symbol(stream, symbols.length))
    else if record_type == DFAState:
      dfa_states.push(read_dfa_state(stream, dfa_states.length, field_count))
    else if record_type == LRState:
      lr_states.push(read_lr_state(stream, lr_states.length, field_count))
    else if record_type == Rule:
      rules.push(read_rule(stream, rules.length, field_count))
    else if record_type == Group:
      groups.push(read_group(stream, groups.length))
    else
      return InvalidRecordType
  if fields_read != field_count:
    return RecordInvalid
```

## Implementation Notes
### Backwardscompatibility
When you develop your engine for your own language, there is no reason to not use the v5.0 grammar.
But when writing a general engine, it might be useful to keep backwards compatibility.

The main differences between v5 and v1 is the existance of groups, and the replacement of charsets with char ranges.
Both can quite easiely be solved.
For the sets or ranges most languages provide some form of type or functional polymorphism that could be used.

The issue with the groups and comment line will be addressed in the next chapter.

### Direct References
The data format returns any references, e.g. to symbols, charsets, states or rules, simply as the index of the respective record.
As these references can only be resolved after the whole file is parsed (as a DFA State might have an edge to the a DFA state from a later record), these references cannot directly be resolved while reading the file.

Keeping the indices is possible, but would result in code for the DFA or LR parser that has to look up the indices each time:
```javascript
function dfa_match(initial_state, text, start_position):
  current_state = dfa_states[initial_state]
  last_match = None
  for position, char in text from start_position:
    current_state = dfa_states[current_state.edge[char]]
    if current_state == ErrorState:
      break
    if current_state.is_final:
      last_match: symbols[current_state.result], position

  if last_match == None:
    return NoMatchFound, 1

  return last_match
```
Which make the code less readable.

For this reason it can be useful to resolve these references beforehand.

One solution would be to use the Counts record to pre create all objects such that they can directly be referenced.
But this might result in objects that have not been fully read being in an unfinished states and might lead to errors down the line.

Another solution would be in OOP languages to hide the access to the arrays through gettes which do the lookup internally.

The solution that was chosen for my typescript engine was to read the data from the grammar file raw, and then create new resolved objects afterwards.

This could be done like this:
```javascript
function create_dfa(initial_state, raw_dfa_states, symbols, charsets):
  dfa_states = []
  for raw_state in raw_dfa_states:
    dfa_states.push(DFAState(raw_state.index, raw_state.is_final, symbols[raw_state.result]))
  for raw_state in raw_dfa_states:
    dfa_state = dfa_states[raw_state.index]
    for edge in raw_state.edges:
      dfa_state.edges.push(charsets[edge.label], dfa_states[edge.target])

  return dfa_states[initial_state]
```

## Example
An example for the real typescript implementation that was developed for the GOLD Parser Tools VSCode extension (at the time of writing) is:
```typescript
export function load_grammar_tables(file: GTFileReader): GrammarParseResult {
  let version_str = file.read_raw_string();
  let version_match = version_str.match(/GOLD Parser Tables\/v(\d).0/);
  if (version_match === null) {
    throw new Error("Magic string not found in file");
  }
  let version = version_match[1];
  let charsets: Array<CharSet> = [];
  let params = new Map<string, string>();
  let dfa_states: Array<ParsedDFAState> = [];
  let dfa_init_state: number = 0;
  let lr_states: Array<ParsedLRState> = [];
  let lr_init_state: number = 0;
  let reductions: Array<ParsedReduction> = [];
  let parsed_groups: Array<ParsedMatchGroup> = [];
  let symbols: Array<ParserSymbol> = [];

  while (!file.eof()) {
    file.start_record();
    let record_type: GrammarRecordType = file.read_byte();

    switch (record_type) {
    case GrammarRecordType.CHARSET:
      charsets.push(parse_charset(file, charsets.length));
      break;

    case GrammarRecordType.DFASTATE:
      dfa_states.push(parse_dfa_state(file, dfa_states.length));
      break;

    case GrammarRecordType.INITIALSTATES:
      dfa_init_state = file.read_int();
      lr_init_state = file.read_int();
      break;

    case GrammarRecordType.LRSTATE:
      lr_states.push(parse_lr_state(file, lr_states.length));
      break;

    case GrammarRecordType.PARAMETER:
      parse_parameter(file, params);
      break;

    case GrammarRecordType.RULE:
      reductions.push(parse_reduction(file, reductions.length));
      break;

    case GrammarRecordType.SYMBOL:
      symbols.push(parse_symbol(file, symbols.length));
      break;

    case GrammarRecordType.COUNTS:
    case GrammarRecordType.COUNTS_V5:
      // No preallocation required just skip
      skip_record(file);
      break;

    case GrammarRecordType.CHARRANGES:
      charsets.push(parse_char_ranges(file, charsets.length));
      break;

    case GrammarRecordType.GROUP:
      parsed_groups.push(parse_group(file, parsed_groups.length));
      break;

    case GrammarRecordType.PROPERTY:
      parse_property(file, params);
      break;
    }

    if (!file.record_finished()) {
      throw new Error("Incomplete record reading");
    }
  }

  build_groups(parsed_groups, symbols, version === "1");

  let rules = reductions.map((r) => {
    return {
      produces: symbols[r.produces],
      consumes: r.consumes.map((c) => symbols[c]),
      index: r.index
    };
  });

  return {
    dfa: build_dfa(dfa_init_state, dfa_states,
                   charsets, symbols),
    lalr: build_lr(lr_init_state, lr_states,
                   rules, symbols),
    params: params,
    rules: rules
  };
}
```

The loading of the grammar is the most tedious part of writing an engine.
In my typescript engine the loader makes up more than double the code of the parsing and lexing algorithm.


[Next: Comments, Groups and other Symbols](./groups.md)
