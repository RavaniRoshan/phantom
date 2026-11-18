import type { EvaluatedValue } from "./component-markdown.ts";

/**
 * Read an MDX attribute expression (`prop={...}`) as literal data, without
 * running it. The agent Markdown downleveler converts components on every
 * page it is handed — plain `.md` pages Astro never executes, and content a
 * CMS or a release feed supplies — so an expression is parsed, never
 * evaluated: only data a reader could see by looking at it is recovered.
 *
 * Accepted: string, number, boolean, `null`, and `undefined` literals; array
 * and object literals, nested; unary minus on a number; template literals
 * whose substitutions are themselves accepted; and `frontmatter.<path>`
 * member access (dot steps, or bracketed string and number literals),
 * resolved against the page's front matter the way `prop={frontmatter.status}`
 * resolves when Astro renders the page. Comments are skipped. Anything else —
 * a call, an operator, a spread, a shorthand property, any other name — is
 * not static, and the caller keeps the component's JSX as written.
 */

/** The outcome of reading an expression: its value, or `ok: false`. */
export interface StaticExpressionResult {
  ok: boolean;
  value: EvaluatedValue;
}

/**
 * Stop reading: the expression isn't literal data. The throw unwinds the
 * recursive descent to {@link readStaticExpression}, which reports it.
 */
const notStatic = (): never => {
  throw new Error("not a static expression");
};

const isText = (value: EvaluatedValue): value is string =>
  typeof value === "string";

const isNumber = (value: EvaluatedValue): value is number =>
  typeof value === "number";

/** A nested map of values: an object literal or a front-matter mapping. */
const isValueMap = (
  value: EvaluatedValue
): value is { [key: string]: EvaluatedValue } =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

/** Whitespace, a line comment, or a block comment. */
const SPACE = /\s+|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//uy;

/** An IdentifierName (ASCII): object keys, member names, keywords. */
const IDENTIFIER = /[$A-Z_a-z][\w$]*/uy;

/**
 * A numeric literal: hex, octal, and binary forms, or a decimal with an
 * optional fraction and exponent, `_` separators allowed between digits. A
 * legacy octal (`017`) matches only its leading `0`, and the check on the
 * following character rejects it, as strict-mode JavaScript does.
 */
const NUMBER =
  /0[Xx][\dA-Fa-f](?:_?[\dA-Fa-f])*|0[Oo][0-7](?:_?[0-7])*|0[Bb][01](?:_?[01])*|(?:(?:0|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[Ee][+-]?\d(?:_?\d)*)?/uy;

/** A character that may not directly follow a number (`1n`, `1px`, `017`). */
const AFTER_NUMBER = /[\w$.]/u;

const DIGIT = /\d/u;
const HEX_DIGITS = /^[\dA-Fa-f]+$/u;

/** A canonical array index: `0`, `12`, never `01`. */
const INDEX = /^(?:0|[1-9]\d*)$/u;

/** The largest Unicode code point, the cap on a `\u{…}` escape. */
const MAX_CODE_POINT = 0x10_ff_ff;

/** U+2028 and U+2029, the line terminators outside ASCII. */
const LINE_SEPARATORS = new Set([
  String.fromCodePoint(0x20_28),
  String.fromCodePoint(0x20_29),
]);

const SIMPLE_ESCAPES = new Map([
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

/** A key that, set through a literal, would replace the object's prototype. */
const PROTO_KEY = "__proto__";

/**
 * `base[key]` on a front-matter value, own data only: a missing key reads as
 * `undefined` (as it does at render time), stepping into `null` or
 * `undefined` is not static (it would throw), and inherited members —
 * methods, `constructor` — are never reached.
 */
const member = (base: EvaluatedValue, key: string): EvaluatedValue => {
  if (base === null || base === undefined) {
    return notStatic();
  }
  if (isText(base) || Array.isArray(base)) {
    if (key === "length") {
      return base.length;
    }
    return INDEX.test(key) ? base[Number(key)] : undefined;
  }
  return isValueMap(base) && Object.hasOwn(base, key) ? base[key] : undefined;
};

/** A recursive-descent reader over one expression's source. */
class Reader {
  readonly frontmatter: Record<string, EvaluatedValue> | undefined;
  pos = 0;
  readonly source: string;

  constructor(
    source: string,
    frontmatter: Record<string, EvaluatedValue> | undefined
  ) {
    this.source = source;
    this.frontmatter = frontmatter;
  }

  /** The character under the cursor (`""` at the end). */
  get char(): string {
    return this.source.charAt(this.pos);
  }

  get done(): boolean {
    return this.pos >= this.source.length;
  }

  /** Match a sticky pattern at the cursor and consume it. */
  match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.pos;
    const found = pattern.exec(this.source)?.[0];
    if (found !== undefined) {
      this.pos += found.length;
    }
    return found;
  }

  /** Skip whitespace and comments. */
  space(): void {
    let skipped = this.match(SPACE);
    while (skipped !== undefined) {
      skipped = this.match(SPACE);
    }
  }

  /** Consume `expected` (after any space), or stop. */
  expect(expected: string): void {
    this.space();
    if (!this.source.startsWith(expected, this.pos)) {
      notStatic();
    }
    this.pos += expected.length;
  }

  value(): EvaluatedValue {
    this.space();
    const { char } = this;
    if (char === "{") {
      return this.object();
    }
    if (char === "[") {
      return this.array();
    }
    if (char === '"' || char === "'") {
      return this.string(char);
    }
    if (char === "`") {
      return this.template();
    }
    if (char === "-") {
      this.pos += 1;
      // `--1` is a decrement, not two negations.
      const operand = this.char === "-" ? notStatic() : this.value();
      return isNumber(operand) ? -operand : notStatic();
    }
    return this.number() ?? this.name();
  }

  number(): number | undefined {
    const text = this.match(NUMBER);
    if (text === undefined) {
      return;
    }
    if (
      AFTER_NUMBER.test(this.char) ||
      (text === "0" && DIGIT.test(this.char))
    ) {
      return notStatic();
    }
    return Number(text.replaceAll("_", ""));
  }

  /** A keyword literal, or `frontmatter` and its member steps. */
  name(): EvaluatedValue {
    const name = this.match(IDENTIFIER);
    if (name === "true") {
      return true;
    }
    if (name === "false") {
      return false;
    }
    if (name === "null") {
      return null;
    }
    if (name === "undefined") {
      return undefined;
    }
    if (name !== "frontmatter") {
      return notStatic();
    }
    let current: EvaluatedValue = this.frontmatter;
    for (;;) {
      this.space();
      if (this.char === ".") {
        this.pos += 1;
        this.space();
        current = member(current, this.match(IDENTIFIER) ?? notStatic());
      } else if (this.char === "[") {
        this.pos += 1;
        const key = this.value();
        this.expect("]");
        current = member(
          current,
          isText(key) || isNumber(key) ? String(key) : notStatic()
        );
      } else {
        return current;
      }
    }
  }

  object(): EvaluatedValue {
    this.pos += 1;
    const out: { [key: string]: EvaluatedValue } = {};
    for (;;) {
      this.space();
      if (this.char === "}") {
        this.pos += 1;
        return out;
      }
      const key = this.key();
      this.expect(":");
      out[key] = this.value();
      this.space();
      if (this.char === ",") {
        this.pos += 1;
      } else if (this.char !== "}") {
        return notStatic();
      }
    }
  }

  /** An object key: a name, a string, or a number (as its canonical string). */
  key(): string {
    const { char } = this;
    let key: string;
    if (char === '"' || char === "'") {
      key = this.string(char);
    } else {
      const number = this.number();
      key =
        number === undefined
          ? (this.match(IDENTIFIER) ?? notStatic())
          : String(number);
    }
    // `{ __proto__: … }` sets the prototype rather than a property.
    return key === PROTO_KEY ? notStatic() : key;
  }

  array(): EvaluatedValue[] {
    this.pos += 1;
    const out: EvaluatedValue[] = [];
    for (;;) {
      this.space();
      if (this.char === "]") {
        this.pos += 1;
        return out;
      }
      out.push(this.value());
      this.space();
      if (this.char === ",") {
        this.pos += 1;
      } else if (this.char !== "]") {
        return notStatic();
      }
    }
  }

  string(quote: string): string {
    this.pos += 1;
    let out = "";
    for (;;) {
      const { char } = this;
      if (this.done || char === "\n" || char === "\r") {
        return notStatic();
      }
      this.pos += 1;
      if (char === quote) {
        return out;
      }
      out += char === "\\" ? this.escape() : char;
    }
  }

  template(): string {
    this.pos += 1;
    let out = "";
    for (;;) {
      if (this.done) {
        return notStatic();
      }
      const { char } = this;
      this.pos += 1;
      if (char === "`") {
        return out;
      }
      if (char === "\\") {
        out += this.escape();
      } else if (char === "$" && this.char === "{") {
        this.pos += 1;
        out += String(this.value());
        this.expect("}");
      } else if (char === "\r") {
        // A raw line break in a template reads as `\n`, `\r\n` included.
        if (this.char === "\n") {
          this.pos += 1;
        }
        out += "\n";
      } else {
        out += char;
      }
    }
  }

  /** What an escape after `\` stands for, under strict-mode rules. */
  escape(): string {
    if (this.done) {
      return notStatic();
    }
    const { char } = this;
    this.pos += 1;
    if (DIGIT.test(char)) {
      // `\0` is NUL; octal escapes, `\8`, and `\9` are errors in strict code.
      return char === "0" && !DIGIT.test(this.char) ? "\0" : notStatic();
    }
    if (char === "x") {
      return String.fromCodePoint(this.hex(2));
    }
    if (char === "u") {
      return String.fromCodePoint(
        this.char === "{" ? this.codePoint() : this.hex(4)
      );
    }
    if (char === "\r") {
      // A line continuation: `\` and the line break stand for nothing.
      if (this.char === "\n") {
        this.pos += 1;
      }
      return "";
    }
    if (char === "\n" || LINE_SEPARATORS.has(char)) {
      return "";
    }
    return SIMPLE_ESCAPES.get(char) ?? char;
  }

  /** Exactly `length` hex digits, as a code point. */
  hex(length: number): number {
    const digits = this.source.slice(this.pos, this.pos + length);
    if (digits.length !== length || !HEX_DIGITS.test(digits)) {
      return notStatic();
    }
    this.pos += length;
    return Number.parseInt(digits, 16);
  }

  /** A braced `\u{…}` code point, the cursor on its `{`. */
  codePoint(): number {
    const end = this.source.indexOf("}", this.pos);
    const digits = end === -1 ? "" : this.source.slice(this.pos + 1, end);
    const code = HEX_DIGITS.test(digits) ? Number.parseInt(digits, 16) : -1;
    if (code < 0 || code > MAX_CODE_POINT) {
      return notStatic();
    }
    this.pos = end + 1;
    return code;
  }
}

/**
 * Read `raw` — an attribute expression's source — as static data, with
 * `frontmatter` (the page's front matter, when the caller has it) behind
 * `frontmatter.<path>` references. Never executes anything.
 */
export const readStaticExpression = (
  raw: string,
  frontmatter?: Record<string, EvaluatedValue>
): StaticExpressionResult => {
  const reader = new Reader(raw, frontmatter);
  try {
    const value = reader.value();
    reader.space();
    return reader.done ? { ok: true, value } : { ok: false, value: undefined };
  } catch {
    // Not literal data (or nested past the stack): keep the JSX as written.
    return { ok: false, value: undefined };
  }
};
