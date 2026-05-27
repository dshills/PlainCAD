import {
  Quantity,
  absQuantity,
  addQuantities,
  assertAllCompatible,
  assertAngle,
  assertScalar,
  divideQuantities,
  makeAngleRadians,
  makeScalar,
  maxQuantity,
  minQuantity,
  multiplyQuantities,
  normalizeQuantity,
  powQuantity,
  sqrtQuantity,
  subtractQuantities,
} from "./units";
import { unitDimension } from "./units";
import { CadParameter } from "../document/schema";

export interface ExpressionError {
  parameterName: string;
  message: string;
  expression: string;
  span?: { start: number; end: number };
}

type Token =
  | { type: "number"; value: string; start: number; end: number }
  | { type: "identifier"; value: string; start: number; end: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/"; start: number; end: number }
  | { type: "paren"; value: "(" | ")"; start: number; end: number }
  | { type: "comma"; value: ","; start: number; end: number };

const MAX_EXPRESSION_TOKENS = 512;
const MAX_EXPRESSION_DEPTH = 32;
const MAX_PARAMETER_CHAIN_DEPTH = 64;
const KNOWN_FUNCTIONS = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "min", "max", "pow"]);

export interface EvaluationContext {
  parameters: Record<string, Quantity>;
}

export interface EvaluationResult {
  quantity?: Quantity;
  dependencies: string[];
  error?: string;
}

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = index;
      while (index < expression.length && /[0-9.]/.test(expression[index])) index += 1;
      const value = expression.slice(start, index);
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) {
        throw new Error(`Invalid number ${value}.`);
      }
      tokens.push({ type: "number", value, start, end: index });
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const start = index;
      while (index < expression.length && /[a-zA-Z0-9_]/.test(expression[index])) index += 1;
      tokens.push({ type: "identifier", value: expression.slice(start, index), start, end: index });
      continue;
    }
    if ("+-*/".includes(char)) {
      tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    throw new Error(`Invalid token '${char}'.`);
  }
  if (tokens.length > MAX_EXPRESSION_TOKENS) throw new Error("Expression token limit exceeded.");
  return tokens;
}

class Parser {
  private cursor = 0;
  readonly dependencies = new Set<string>();

  constructor(
    private readonly tokens: Token[],
    private readonly context: EvaluationContext,
  ) {}

  parse(): Quantity {
    const result = this.parseAdditive(0);
    if (!this.isAtEnd()) throw new Error("Unexpected token.");
    return result;
  }

  private parseAdditive(depth: number): Quantity {
    this.assertDepth(depth);
    let left = this.parseMultiplicative(depth + 1);
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative(depth + 1);
      left = operator === "+" ? addQuantities(left, right) : subtractQuantities(left, right);
    }
    return left;
  }

  private parseMultiplicative(depth: number): Quantity {
    this.assertDepth(depth);
    let left = this.parseUnary(depth + 1);
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parseUnary(depth + 1);
      left = operator === "*" ? multiplyQuantities(left, right) : divideQuantities(left, right);
    }
    return left;
  }

  private parseUnary(depth: number): Quantity {
    this.assertDepth(depth);
    if (this.matchOperator("+")) return this.parseUnary(depth + 1);
    if (this.matchOperator("-")) {
      const value = this.parseUnary(depth + 1);
      return { ...value, value: -value.value };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): Quantity {
    this.assertDepth(depth);
    if (this.matchParen("(")) {
      const value = this.parseAdditive(depth + 1);
      if (!this.matchParen(")")) throw new Error("Expected closing parenthesis.");
      return value;
    }
    const currentToken = this.advance();
    if (!currentToken) throw new Error("Expected expression.");
    if (currentToken.type === "number") {
      const parsed = Number(currentToken.value);
      if (!Number.isFinite(parsed)) throw new Error(`Invalid number ${currentToken.value}.`);
      let unit = "";
      const possibleUnit = this.peek();
      if (possibleUnit?.type === "identifier") {
        try {
          unitDimension(possibleUnit.value);
          unit = this.advance()!.value;
        } catch {
          throw new Error(`Expected operator before ${possibleUnit.value}.`);
        }
      }
      return normalizeQuantity(parsed, unit);
    }
    if (currentToken.type === "identifier") {
      const name = currentToken.value;
      const isFunctionCall = this.peek()?.type === "paren" && this.peek()?.value === "(";
      if (isFunctionCall) {
        this.advance();
        return this.evaluateFunction(name, this.parseArguments(depth + 1));
      }
      const parameter = this.context.parameters[name];
      if (!parameter) throw new Error(`Unknown parameter ${name}.`);
      this.dependencies.add(name);
      return parameter;
    }
    throw new Error("Expected value.");
  }

  private parseArguments(depth: number): Quantity[] {
    this.assertDepth(depth);
    if (this.matchParen(")")) return [];
    const args: Quantity[] = [];
    do {
      args.push(this.parseAdditive(depth + 1));
      if (this.matchParen(")")) return args;
      if (!this.matchComma()) throw new Error("Expected comma or closing parenthesis.");
    } while (!this.isAtEnd());
    throw new Error("Expected closing parenthesis.");
  }

  private evaluateFunction(name: string, args: Quantity[]): Quantity {
    switch (name) {
      case "sin":
      case "cos":
      case "tan": {
        this.expectArity(name, args, 1);
        assertAngle(args[0], `${name} argument`);
        return makeScalar(Math[name](args[0].value));
      }
      case "asin":
      case "acos":
      case "atan": {
        this.expectArity(name, args, 1);
        assertScalar(args[0], `${name} argument`);
        if ((name === "asin" || name === "acos") && Math.abs(args[0].value) > 1) {
          throw new Error(`${name} argument must be between -1 and 1.`);
        }
        const fn = name === "asin" ? Math.asin : name === "acos" ? Math.acos : Math.atan;
        return makeAngleRadians(fn(args[0].value));
      }
      case "sqrt":
        this.expectArity(name, args, 1);
        return sqrtQuantity(args[0]);
      case "abs":
        this.expectArity(name, args, 1);
        return absQuantity(args[0]);
      case "min":
        assertAllCompatible(args);
        return minQuantity(args);
      case "max":
        assertAllCompatible(args);
        return maxQuantity(args);
      case "pow":
        this.expectArity(name, args, 2);
        return powQuantity(args[0], args[1]);
      default:
        throw new Error(`Unknown function ${name}.`);
    }
  }

  private expectArity(name: string, args: Quantity[], expected: number) {
    if (args.length !== expected) throw new Error(`${name} expects ${expected} argument${expected === 1 ? "" : "s"}.`);
  }

  private matchOperator(value: "+" | "-" | "*" | "/"): boolean {
    const token = this.peek();
    if (token?.type === "operator" && token.value === value) {
      this.cursor += 1;
      return true;
    }
    return false;
  }

  private matchParen(value: "(" | ")"): boolean {
    const token = this.peek();
    if (token?.type === "paren" && token.value === value) {
      this.cursor += 1;
      return true;
    }
    return false;
  }

  private matchComma(): boolean {
    const token = this.peek();
    if (token?.type === "comma") {
      this.cursor += 1;
      return true;
    }
    return false;
  }

  private assertDepth(depth: number) {
    if (depth > MAX_EXPRESSION_DEPTH) throw new Error("Expression depth limit exceeded.");
  }

  private advance(): Token | undefined {
    if (this.isAtEnd()) return undefined;
    this.cursor += 1;
    return this.previous();
  }

  private previous(): Token {
    return this.tokens[this.cursor - 1];
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.tokens.length;
  }
}

export function evaluateExpression(expression: string, context: EvaluationContext): EvaluationResult {
  try {
    const parser = new Parser(tokenize(expression), context);
    const quantity = parser.parse();
    return { quantity, dependencies: [...parser.dependencies] };
  } catch (error) {
    return { dependencies: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function collectExpressionDependencies(expression: string): string[] {
  const tokens = tokenize(expression);
  const dependencies = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous?.type === "number") continue;
    if (next?.type === "paren" && next.value === "(" && KNOWN_FUNCTIONS.has(token.value)) continue;
    dependencies.add(token.value);
  }
  return [...dependencies];
}

export interface ParameterEvaluation {
  values: Record<string, Quantity>;
  parameters: Record<string, CadParameter>;
  errors: ExpressionError[];
}

export function evaluateParameters(parameters: Record<string, CadParameter>): ParameterEvaluation {
  const values: Record<string, Quantity> = {};
  const resolved: Record<string, CadParameter> = {};
  const errors: ExpressionError[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string, depth = 0): Quantity | undefined => {
    if (depth > MAX_PARAMETER_CHAIN_DEPTH) {
      const parameter = parameters[name];
      errors.push({ parameterName: name, message: "Parameter dependency depth limit exceeded.", expression: parameter?.expression ?? "" });
      return undefined;
    }
    if (values[name]) return values[name];
    const parameter = parameters[name];
    if (!parameter) return undefined;
    if (visiting.has(name)) {
      errors.push({ parameterName: name, message: `Circular dependency involving ${name}.`, expression: parameter.expression });
      return undefined;
    }
    if (visited.has(name)) return values[name];
    visiting.add(name);
    let dependencies: string[];
    try {
      dependencies = collectExpressionDependencies(parameter.expression);
    } catch (error) {
      visiting.delete(name);
      visited.add(name);
      errors.push({ parameterName: name, message: error instanceof Error ? error.message : String(error), expression: parameter.expression });
      return undefined;
    }
    for (const dependency of dependencies) visit(dependency, depth + 1);
    const result = evaluateExpression(parameter.expression, { parameters: values });
    visiting.delete(name);
    visited.add(name);
    if (result.error || !result.quantity) {
      errors.push({ parameterName: name, message: result.error ?? "Invalid expression.", expression: parameter.expression });
      return undefined;
    }
    values[name] = result.quantity;
    resolved[name] = { ...parameter, value: result.quantity.value, unit: result.quantity.unit };
    return result.quantity;
  };

  for (const name of Object.keys(parameters)) visit(name);
  return { values, parameters: { ...parameters, ...resolved }, errors };
}
