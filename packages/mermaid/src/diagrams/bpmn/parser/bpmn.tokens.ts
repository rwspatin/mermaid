import { createToken, Lexer } from 'chevrotain';
import type { CustomPatternMatcherFunc, TokenType } from 'chevrotain';

const asMatch = (image: string, offset: number, text: string): RegExpExecArray => {
  const match = [image] as unknown as RegExpExecArray;
  match.index = offset;
  match.input = text;
  return match;
};

const INDENT_PATTERN = /[\t ]+/y;

const matchIndent: CustomPatternMatcherFunc = (text, offset) => {
  if (offset > 0 && text[offset - 1] !== '\n' && text[offset - 1] !== '\r') {
    return null;
  }
  INDENT_PATTERN.lastIndex = offset;
  const match = INDENT_PATTERN.exec(text);
  return match ? asMatch(match[0], offset, text) : null;
};

export const Indent = createToken({
  name: 'Indent',
  pattern: matchIndent,
  line_breaks: false,
  start_chars_hint: ['\t', ' '],
});

export const Newline = createToken({ name: 'Newline', pattern: /\r\n|\n|\r/, line_breaks: true });
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[\t ]+/,
  group: Lexer.SKIPPED,
});
export const Comment = createToken({
  name: 'Comment',
  pattern: /%%[^\n\r]*/,
  group: Lexer.SKIPPED,
});

// A single word token covers both element keywords and identifiers. Keyword tolerance
// (case-insensitivity + synonyms) is resolved by POSITION in the visitor, not by the lexer,
// so it never reserves a word that is used as an id or as a flow endpoint. A word that only
// begins with a keyword is naturally still one word here — there is nothing to shadow.
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[A-Z_a-z]\w*(?:-\w+)*/,
});

// `bpmn-beta` opens the diagram; matched case-insensitively for the same tolerance as the
// keywords. It is longer than any real id and never conflicts with one.
export const Header = createToken({
  name: 'Header',
  pattern: /bpmn-beta/i,
  longer_alt: Identifier,
});

export const Title = createToken({
  name: 'Title',
  pattern: /title[\t ]+[^\n\r]*/,
  longer_alt: Identifier,
});
export const AccTitle = createToken({ name: 'AccTitle', pattern: /accTitle[\t ]*:[^\n\r]*/ });
export const AccDescrMultiline = createToken({
  name: 'AccDescrMultiline',
  pattern: /accDescr[\t ]*{[^}]*}/,
  line_breaks: true,
});
export const AccDescr = createToken({ name: 'AccDescr', pattern: /accDescr[\t ]*:[^\n\r]*/ });

export const QuotedString = createToken({ name: 'QuotedString', pattern: /"[^\n\r"]*"/ });

export const LabelledArrow = createToken({
  name: 'LabelledArrow',
  pattern: /--(?![>-])[^\n\r]*?--+>/,
});
// `-.->` is the canonical message flow; `=>` and `==>` (exactly) are accepted synonyms.
export const MessageArrow = createToken({ name: 'MessageArrow', pattern: /-\.->|={1,2}>/ });
// `-->` is the canonical sequence flow; the unicode arrow `→` is an accepted synonym.
export const Arrow = createToken({ name: 'Arrow', pattern: /--+>|→/ });

export const AssociationArrow = createToken({ name: 'AssociationArrow', pattern: /\.\.+>/ });

export const AssociationLine = createToken({ name: 'AssociationLine', pattern: /\.\.\.+/ });

export const bpmnTokens: TokenType[] = [
  Indent,
  Newline,
  WhiteSpace,
  Comment,
  LabelledArrow,
  MessageArrow,
  Arrow,
  AssociationArrow,
  AssociationLine,
  Title,
  AccTitle,
  AccDescrMultiline,
  AccDescr,
  QuotedString,
  Header,
  Identifier,
];
