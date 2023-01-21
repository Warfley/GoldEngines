# Node GOLD Engine

This is an engine for the GOLD Parsing System (http://goldparser.org/) written in typescript for node.js.

The engine was developed as part of the gold-parser-tools VSCode extension (https://github.com/Warfley/gold-parser-tools).

## Features
* v1.0 and v5.0 support
* build parsing tree for grammar
* event based hooking points on shift, reduce and lexical analysis

## Example Usage:
```typescript
  let grammar_reader = await GTFileReader.from_file(cgt_file);
  let grammar_tables = load_grammar_tables(grammar_reader);

  let parse_result = await parse_string(input_text, grammar_tables.dfa, grammar_tables.lalr,
                                        on_lex, on_reduce, on_shift);
  print_parse_tree(parse_result);
```

## Documentation
Currently no documentation available specifically for the node engine.

For general engine design and how to construct your own engine check out https://github.com/Warfley/goldengine/docs
