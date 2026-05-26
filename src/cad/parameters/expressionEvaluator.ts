import {
  Quantity,
  addQuantities,
  divideQuantities,
  multiplyQuantities,
  normalizeQuantity,
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
  | { type: "paren"; value: "(" | ")"; start: number; end: number };

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
    throw new Error(`Invalid token '${char}'.`);
  }
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
    const result = this.parseAdditive();
    if (!this.isAtEnd()) throw new Error("Unexpected token.");
    return result;
  }

  private parseAdditive(): Quantity {
    let left = this.parseMultiplicative();
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      left = operator === "+" ? addQuantities(left, right) : subtractQuantities(left, right);
    }
    return left;
  }

  private parseMultiplicative(): Quantity {
    let left = this.parseUnary();
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = operator === "*" ? multiplyQuantities(left, right) : divideQuantities(left, right);
    }
    return left;
  }

  private parseUnary(): Quantity {
    if (this.matchOperator("+")) return this.parseUnary();
    if (this.matchOperator("-")) {
      const value = this.parseUnary();
      return { ...value, value: -value.value };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Quantity {
    if (this.matchParen("(")) {
      const value = this.parseAdditive();
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
      const parameter = this.context.parameters[currentToken.value];
      if (!parameter) throw new Error(`Unknown parameter ${currentToken.value}.`);
      this.dependencies.add(currentToken.value);
      return parameter;
    }
    throw new Error("Expected value.");
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

  const visit = (name: string): Quantity | undefined => {
    if (values[name]) return values[name];
    const parameter = parameters[name];
    if (!parameter) return undefined;
    if (visiting.has(name)) {
      errors.push({ parameterName: name, message: `Circular dependency involving ${name}.`, expression: parameter.expression });
      return undefined;
    }
    if (visited.has(name)) return values[name];
    visiting.add(name);
    const depsOnly = evaluateExpression(parameter.expression, { parameters: Object.fromEntries(Object.keys(parameters).map((key) => [key, normalizeQuantity(0, parameters[key].unit)])) });
    for (const dependency of depsOnly.dependencies) visit(dependency);
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
