# GOLD Engine Design

When creating a parser, the formal grammar of the language needs to be translated into an algorithm that can take a text within that language and return a computer readable translation.
For context free grammars, this is usually done by building a parse tree using a stack automata.
The GOLD builder helps with this by taking a formal grammar definition and automatically create these automatas from the definition.
On the user side, the application then just needs to implement the functionality for constructing and executing these automatas as described by the compiled grammar tables file (.egt or .cgt) created by the GOLD builder.

This documentation is intendet help for anyone wishing to implement such a parser for their application.
It describes the general algorithms for building and executing these automatas, how to read the dataformat created by the GOLD Builder, as well as some caveats and tricks for building such an engine.
These descriptions are intendet to be mostly language agnostic, but examples will be given in an imperative style pseudo code.
I will also at some points show example code from the engine I've written for the `gold-parser-toos` VSCode addon, which was written in typescript.


## General Architecture

A parsing algorithm generally consists of two components, the lexer and the parser.

### Lexer
The lexer, as the name suggests, is doing the lexical analysis.
The goal of which is to take the input text, and create a stream of tokens on which the parser can operate.
This reduces the input to the minimal amount of information necessary.
Take this example code:
```C
  a = 3;
  b < 42;
```
these two lines are on a character level completely different, but when we look closely, both of them are basically just a series of tokens with different names.
In both cases we have some `whitespace`s followed by an `identifier`, then either an `assignment` or `comparison` operator, a `value` and a `semicolon`.
This is the job of the lexer, it takes the character based input stream, and turns it into a series of tokens on what these characters represent.

Of course while the symbols represent similar structures, semantically these two are very different, a is a different object than b and 3 is a different value from 42.
In order to preserve this information the lexer must also store the underlying values for each of the tokens, so it can be used later for semantic analysis.

For building a lexer, a Deterministic Finite Automata (DFA) is used.
The information on how to construct this automata for the given language is provided by the GOLD grammar.


### Parser
The parser then looks at the stream of tokens, and tries to build a parsing tree.
This parsing tree represents the structure as defined in the grammar.
Take the following grammar (numbering of rules):
```xml
<Equality> ::= <Expression> '==' <Expression> (1)

<Expression> ::= <Value> Operator <Value> (2)
              |  <Value> (3)

<Value> ::= Identifier (4)
         |  Constant (5)
```

With the following example
```C
  a == 3 + b
```
Would then correspond to the following parse tree:
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
The goal of the parser is now to construct this tree.
GOLD is creating an LALR(1) parser, which is a bottom up (LR) parser with 1 character look ahead (LA).
This means the parser will look at one token at a time and will build the parse tree from the ground up.
So in our example, it will first read the first token, which is a `Identifier`.
The parser can then conclude that the `Identifier` belongs to a `<Value>` as per rule (4), and can create this subtree.
But now the parser has a problem, it cannot know if this is already the end of the `<Expression>` from rule (3), or if this is a larger expression described by rule (2).
For this the parser has a look ahead of 1 character. By looking at the next character, the parser can see that this Equals is not part of rule (2).
Therefore the parser can conclude that rule (3) must be applied and the `<Value>` must form an `<Expression>`.
Already the parser has built the following subtreee
```xml
<Expression>
+--<Value>
   +--Identifier
```
This is why this is called a bottom up parser, it begins at the bottom and creates the parse tree from the leafs first.
After it is finished, the parser has generated the whole parse tree, which can then be programatically parsed.

While parsing, the parser will only read the next token, after the current look ahead is consumed.
In the example above, after reading and consuming the first `Identifier`, the parser sees the look ahead for the `Equals` but first performs two steps (the reductions to value `<Value>` and then to `<Expression>`) before consuming it and looking at the next look ahead.

This consuming of the look ahead is called a `shift`, while the building of the parent node in the parse tree is called a `reduction`.
So in the example above, what the parser did to build this subtree was one `shift` for reading the `Identifier` and then two `reductions` one for `<Value>` and one for `<Expression>`

The parser is implemented using a stack automata. The instructions for constructing the automata for a given grammar are provided by the GOLD grammar.

### A General Algorithm
Therefore a parser generally follows the following algorithm:
```javascript
function parse():
  look_ahead = next_token()
  while not finished:
    if parser_step(look_ahead) == shift:
      look_ahead = next_token()
```

This looks very easy, and it is.
The base functionality of a parser is quite simple to implement.
Of course most functionalities is hidden behind the `next_token` function which calls the lexer and the `parser_step` function.
But as we will see, those are still quite simple algorithms when the automatas are provided.
The main effort is in building the automatas for the respective language to begin with, but this is taken care of by the GOLD parser.


## Implementing Documentation
In the following each of the components is documented:

* [Building a DFA](./lexer.md)
* [Building an LR(1) Automata](./parser.md)
* [The GOLD Grammar Table format](./grammars.md)
* [Comments, Groups and other Symbols](./groups.md)
