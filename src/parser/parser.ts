import { operators } from "../constants";
import { parseSignature } from "../signatures";
import { tokenizer, Tokenizer, Token } from "../tokenizer";
import { isNumeric } from "../utils";
import { ast_optimize } from "./optimize";
import { ErrorCollector } from "./errors";
import * as ast from "./ast";

export type NUD = (state: ParserState) => ast.ASTNode;
export type LED = (state: ParserState, left: ast.ASTNode) => ast.ASTNode;

export interface Symbol {
    id: string;
    lbp: number;
    nud: NUD;
    led?: LED;
    position?: number;
    value: any;
}

// export class ParserState {
//     lexer: Tokenizer;
//     constructor(source: string) {
//         this.lexer = tokenizer(source);
//     }
// }

export interface NodeType {
    id: string;
    error?: any;
    type?: string;
    position?: number;
    value?: any;
}

export interface ParserState {
    symbol: Symbol;
    token: Token;
    error: any;
}

// This parser implements the 'Top down operator precedence' algorithm developed by Vaughan R Pratt; http://dl.acm.org/citation.cfm?id=512931.
// and builds on the Javascript framework described by Douglas Crockford at http://javascript.crockford.com/tdop/tdop.html
// and in 'Beautiful Code', edited by Andy Oram and Greg Wilson, Copyright 2007 O'Reilly Media, Inc. 798-0-596-51004-6
export function parser(source, recover?: boolean) {
    var current: ParserState;
    var lexer: Tokenizer;

    var remainingTokens = () => {
        var remaining: Token[] = [];
        if (current.symbol.id !== "(end)") {
            remaining.push(current.token);
        }
        var nxt: Token = lexer(undefined);
        while (nxt !== null) {
            remaining.push(nxt);
            nxt = lexer(undefined);
        }
        return remaining;
    };

    function createTable(): { [id: string]: Symbol } {
        let symbol_table: { [id: string]: Symbol } = {};

        let defaultNud: NUD = (state: ParserState): ast.ErrorNode => {
            // error - symbol has been invoked as a unary operator
            var err: any = {
                code: "S0211",
                token: state.token.value,
                position: state.token.position,
            };

            if (recover) {
                err.remaining = remainingTokens();
                err.type = "error";
                errors.push(err);
                return err;
            } else {
                err.stack = new Error().stack;
                throw err;
            }
        };

        var getSymbol = (id, bp: number): Symbol => {
            bp = bp || 0;
            if (symbol_table.hasOwnProperty(id)) {
                let s = symbol_table[id];
                // TODO: Should this ever happen?!?  Aren't we overwriting something?!?
                if (bp >= s.lbp) {
                    s.lbp = bp;
                }
                return s;
            } else {
                let s: Symbol = {
                    id: id,
                    lbp: bp,
                    value: id,
                    nud: defaultNud,
                };
                symbol_table[id] = s;
                return s;
            }
        };

        // A terminal could be a 'literal', 'variable', 'name'
        var terminal = (id) => {
            var s = getSymbol(id, 0);
            s.nud = (state: ParserState): ast.TerminalNode => {
                let token = state.token;
                switch (state.token.type) {
                    case "variable":
                        return {
                            type: "variable",
                            value: token.value,
                            position: token.position,
                        };
                    case "name":
                        return {
                            type: "name",
                            value: token.value,
                            position: token.position,
                        };
                    case "literal":
                        return {
                            type: "literal",
                            value: token.value,
                            position: token.position,
                        };
                    case "regex":
                        return {
                            type: "regex",
                            value: token.value,
                            position: token.position,
                        };
                    case "operator":
                        return {
                            type: "operator",
                            value: token.value,
                            position: token.position,
                        };
                    default:
                        /* istanbul ignore next */
                        if (state.symbol.id !== "(end)") {
                            throw new Error("Unexpected terminal: " + JSON.stringify(self));
                        }
                        return {
                            type: "end",
                            value: "(end)",
                            position: token.position,
                        }
                }
            };
        };

        // match infix operators
        // <expression> <operator> <expression>
        // left associative
        // TODO: Add default values for bp and led
        var infix = (id: string, bp?: number, led?: LED) => {
            var bindingPower = bp || operators[id];
            var s = getSymbol(id, bindingPower);
            let defaultLED: LED = (state: ParserState, left: ast.ASTNode): ast.BinaryNode => {
                let rhs = expression(bindingPower);
                return {
                    value: state.token.value,
                    type: "binary",
                    lhs: left,
                    rhs: rhs,
                };
            };
            s.led = led || defaultLED;
            return s;
        };

        // match infix operators
        // <expression> <operator> <expression>
        // right associative
        // TODO: Add default values for bp and led
        var infixr = (id, bp?, led?: LED) => {
            var bindingPower = bp || operators[id];
            var s = getSymbol(id, bindingPower);
            let defaultLED: LED = (state: ParserState, left: ast.ASTNode): ast.BinaryNode => {
                let rhs = expression(bindingPower - 1); // subtract 1 from bindingPower for right associative operators
                return {
                    value: state.token.value,
                    type: "binary",
                    lhs: left,
                    rhs: rhs,
                };
            };
            s.led =
                led ||
                defaultLED;
            return s;
        };

        // match prefix operators
        // <operator> <expression>
        var prefix = (id, nud?: NUD) => {
            var s = getSymbol(id, 0);
            let defaultNUD: NUD = (state: ParserState): ast.UnaryNode => {
                return {
                    value: state.token.value,
                    type: "unary",
                    expression: expression(70),
                };
            };
            s.nud =
                nud ||
                defaultNUD;
            return s;
        };

        terminal("(end)");
        terminal("(name)");
        terminal("(literal)");
        terminal("(regex)");
        getSymbol(":", 0);
        getSymbol(";", 0);
        getSymbol(",", 0);
        getSymbol(")", 0);
        getSymbol("]", 0);
        getSymbol("}", 0);
        getSymbol("..", 0); // range operator
        infix("."); // field reference
        infix("+"); // numeric addition
        infix("-"); // numeric subtraction
        infix("*"); // numeric multiplication
        infix("/"); // numeric division
        infix("%"); // numeric modulus
        infix("="); // equality
        infix("<"); // less than
        infix(">"); // greater than
        infix("!="); // not equal to
        infix("<="); // less than or equal
        infix(">="); // greater than or equal
        infix("&"); // string concatenation
        infix("and"); // Boolean AND
        infix("or"); // Boolean OR
        infix("in"); // is member of array
        terminal("and"); // the 'keywords' can also be used as terminals (field names)
        terminal("or"); //
        terminal("in"); //
        infixr(":="); // bind variable
        prefix("-"); // unary numeric negation
        infix("~>"); // function application

        infixr("(error)", 10, (state: ParserState, left: ast.ASTNode): ast.ErrorNode => {
            return {
                value: state.token.value,
                lhs: left,
                error: state.error,
                remaining: remainingTokens(),
                type: "error",
            };
        });

        // field wildcard (single level)
        prefix("*", (state: ParserState): ast.WildcardNode => {
            return {
                value: state.token.value,
                type: "wildcard",
            };
        });

        // descendant wildcard (multi-level)
        prefix("**", (state: ParserState): ast.DescendantNode => {
            return {
                value: state.token.value,
                type: "descendant",
            };
        });

        // function invocation
        infix("(", operators["("], (
            state: ParserState,
            left: ast.ASTNode,
        ): ast.FunctionInvocationNode | ast.LambdaDefinitionNode => {
            // left is is what we are trying to invoke
            let type: "function" | "partial" = "function";
            let args = [];
            if (current.symbol.id !== ")") {
                for (;;) {
                    if (current.token.type === "operator" && current.symbol.id === "?") {
                        // partial function application
                        type = "partial";
                        args.push({
                            type: "operator",
                            position: current.token.position,
                            value: current.token.value,
                        });
                        advance("?");
                    } else {
                        args.push(expression(0));
                    }
                    if (current.symbol.id !== ",") break;
                    advance(",");
                }
            }
            advance(")", true);

            // if the name of the function is 'function' or λ, then this is function definition (lambda function)
            let isLambda = left.type === "name" && (left.value === "function" || left.value === "\u03BB");

            if (!isLambda) {
                let alt: ast.FunctionInvocationNode = {
                    position: state.token.position,
                    value: state.token.value,
                    type: type,
                    arguments: args,
                    procedure: left,
                };
                return alt;
            }
            // all of the args must be VARIABLE tokens
            args.forEach((arg, index) => {
                if (arg.type !== "variable") {
                    return handleError({
                        code: "S0208",
                        stack: new Error().stack,
                        position: arg.position,
                        token: arg.value,
                        value: index + 1,
                    });
                }
            });
            // is the next token a '<' - if so, parse the function signature
            let signature = undefined;
            if (current.symbol.id === "<") {
                var sigPos = current.token.position;
                var depth = 1;
                var sig = "<";
                let id = current.symbol.id;
                // TODO: Bug in typescript compiler?...doesn't recognize side effects in advance and impact on node value
                while (depth > 0 && id !== "{" && id !== "(end)") {
                    advance();
                    id = current.symbol.id;
                    if (id === ">") {
                        depth--;
                    } else if (id === "<") {
                        depth++;
                    }
                    sig += current.token.value;
                }
                advance(">");
                try {
                    signature = parseSignature(sig);
                } catch (err) {
                    // insert the position into this error
                    err.position = sigPos + err.offset;
                    // TODO: If recover is true, we need to force the return of an
                    // error node here.  In the tests, recover is never set so this
                    // always throws.
                    handleError(err);
                    /* istanbul ignore next */
                    throw err;
                }
            }
            // parse the function body
            advance("{");
            let body = expression(0);
            advance("}");
            return {
                value: state.token.value,
                type: "lambda",
                body: body,
                signature: signature,
                procedure: left,
                arguments: args,
            };
        });

        // parenthesis - block expression
        prefix("(", (state: ParserState): ast.BlockNode => {
            var expressions = [];
            while (current.symbol.id !== ")") {
                expressions.push(expression(0));
                if (current.symbol.id !== ";") {
                    break;
                }
                advance(";");
            }
            advance(")", true);
            return {
                value: state.token.value,
                type: "block",
                expressions: expressions,
            };
        });

        // array constructor
        prefix("[", (state: ParserState): ast.UnaryNode => {
            var a = [];
            if (current.symbol.id !== "]") {
                for (;;) {
                    var item = expression(0);
                    if (current.symbol.id === "..") {
                        let position = current.token.position;
                        let lhs = item;
                        // range operator
                        advance("..");
                        let rhs = expression(0);
                        var range: ast.BinaryNode = { type: "binary", value: "..", position: position, lhs: lhs, rhs: rhs };
                        item = range;
                    }
                    a.push(item);
                    if (current.symbol.id !== ",") {
                        break;
                    }
                    advance(",");
                }
            }
            advance("]", true);
            // TODO: Should this be a different type...? (not unary)
            return {
                value: state.token.value,
                type: "unary",
                expressions: a,
            };
        });

        // filter - predicate or array index
        infix("[", operators["["], (state: ParserState, left: ast.ASTNode): ast.ASTNode | ast.BinaryNode => {
            if (current.symbol.id === "]") {
                // empty predicate means maintain singleton arrays in the output
                var step = left;
                while (step && step.type === "binary" && step.value === "[") {
                    let s = step as ast.BinaryNode;
                    step = s.lhs;
                }
                step.keepArray = true;
                advance("]");
                return left;
            } else {
                let rhs = expression(operators["]"]);
                advance("]", true);
                let ret: ast.BinaryNode = {
                    value: state.token.value,
                    type: "binary",
                    lhs: left,
                    rhs: rhs,
                };
                return ret;
            }
        });

        // order-by
        infix("^", operators["^"], (state: ParserState, left: ast.ASTNode): ast.BinaryNode => {
            advance("(");
            var terms = [];
            for (;;) {
                var term = {
                    descending: false,
                };
                if (current.symbol.id === "<") {
                    // ascending sort
                    advance("<");
                } else if (current.symbol.id === ">") {
                    // descending sort
                    term.descending = true;
                    advance(">");
                } else {
                    //unspecified - default to ascending
                }
                // TODO: Fix any cast
                (term as any).expression = expression(0);
                terms.push(term);
                if (current.symbol.id !== ",") {
                    break;
                }
                advance(",");
            }
            advance(")");
            return {
                position: state.token.position, // REQUIRED?!?
                value: state.token.value,
                type: "binary",
                lhs: left,
                rhs: terms, // TODO: Not an expression node...different node type recommended
            };
        });

        var objectParserNUD = (state: ParserState): ast.UnaryNode => {
            var a = [];
            /* istanbul ignore else */
            if (current.symbol.id !== "}") {
                for (;;) {
                    var n = expression(0);
                    advance(":");
                    var v = expression(0);
                    a.push([n, v]); // holds an array of name/value expression pairs
                    if (current.symbol.id !== ",") {
                        break;
                    }
                    advance(",");
                }
            }
            advance("}", true);
            // NUD - unary prefix form
            return {
                value: state.token.value,
                type: "unary",
                lhs: a, // TODO: use expression
            };
        };

        var objectParserLED = (state: ParserState, left: ast.ASTNode): ast.BinaryNode => {
            var a = [];
            /* istanbul ignore else */
            if (current.symbol.id !== "}") {
                for (;;) {
                    var n = expression(0);
                    advance(":");
                    var v = expression(0);
                    a.push([n, v]); // holds an array of name/value expression pairs
                    if (current.symbol.id !== ",") {
                        break;
                    }
                    advance(",");
                }
            }
            advance("}", true);
            // LED - binary infix form
            return {
                value: state.token.value,
                type: "binary",
                lhs: left,
                rhs: a,
            };
        };

        // object constructor
        prefix("{", objectParserNUD);

        // object grouping
        infix("{", operators["{"], objectParserLED);

        // if/then/else ternary operator ?:
        infix("?", operators["?"], (state: ParserState, left): ast.TernaryNode => {
            let then = expression(0);
            let otherwise = undefined;
            if (current.symbol.id === ":") {
                // else condition
                advance(":");
                otherwise = expression(0);
            }
            return {
                value: state.token.value,
                type: "condition",
                condition: left,
                then: then,
                else: otherwise,
            };
        });

        // object transformer
        prefix("|", (state: ParserState): ast.TransformNode => {
            let expr = expression(0);
            advance("|");
            let update = expression(0);
            let del = undefined;
            if (current.symbol.id === ",") {
                advance(",");
                del = expression(0);
            }
            advance("|");
            return {
                value: state.token.value,
                type: "transform",
                pattern: expr,
                update: update,
                delete: del,
            };
        });

        return symbol_table;
    }

    var errors = [];
    let symbol_table = createTable();

    var handleError = (err): void => {
        if (recover) {
            // tokenize the rest of the buffer and add it to an error token
            err.remaining = remainingTokens();
            errors.push(err);
            var symbol = symbol_table["(error)"];
            current = {
                symbol: Object.create(symbol),
                token: {
                    type: "(error)",
                    value: null,
                    position: current.token.position,
                },
                error: err,
            };
        } else {
            err.stack = new Error().stack;
            throw err;
        }
    };

    // TODO: Add types
    var advance = (id?: string, infix?: boolean): void => {
        if (id && current.symbol.id !== id) {
            var code;
            if (current.symbol.id === "(end)") {
                // unexpected end of buffer
                code = "S0203";
            } else {
                code = "S0202";
            }
            var err = {
                code: code,
                position: current.token.position,
                token: current.token.value,
                value: id,
            };
            return handleError(err);
        }
        var next_token: Token = lexer(infix);
        if (next_token === null) {
            let symbol = symbol_table["(end)"]
            current = {
                symbol: Object.create(symbol),
                token: {
                    type: "(end)",
                    value: symbol.value,
                    position: source.length,
                },
                error: undefined,
            };
            return;
        }
        var value = next_token.value;
        var type = next_token.type;
        var symbol;
        switch (type) {
            case "name":
            case "variable":
                symbol = symbol_table["(name)"];
                break;
            case "operator":
                symbol = symbol_table[value];
                if (!symbol) {
                    return handleError({
                        code: "S0204",
                        stack: new Error().stack,
                        position: next_token.position,
                        token: value,
                    });
                }
                break;
            case "string":
            case "number":
            case "value":
                type = "literal";
                symbol = symbol_table["(literal)"];
                break;
            case "regex":
                type = "regex";
                symbol = symbol_table["(regex)"];
                break;
            /* istanbul ignore next */
            default:
                return handleError({
                    code: "S0205",
                    stack: new Error().stack,
                    position: next_token.position,
                    token: value,
                });
        }

        current = {
            symbol: Object.create(symbol),
            token: {
                value: value,
                type: type,
                position: next_token.position,
            },
            error: undefined,
        };
        return;
    };

    // Pratt's algorithm
    var expression = (rbp: number): ast.ASTNode => {
        var c = current;
        advance(null, true);
        var left: ast.ASTNode = c.symbol.nud(c);
        while (rbp < current.symbol.lbp) {
            c = current;
            advance();
            left = c.symbol.led(c, left);
        }
        return left;
    };

    // now invoke the tokenizer and the parser and return the syntax tree
    lexer = tokenizer(source);
    advance();
    // parse the tokens
    var expr = expression(0);
    if (current.symbol.id !== "(end)") {
        var err = {
            code: "S0201",
            position: current.token.position,
            token: current.token.value,
        };
        handleError(err);
    }

    // Decide if we want to collect errors and recover, or just throw an error
    let collect = recover ? err => errors.push(err) : undefined;
    expr = ast_optimize(expr, collect);

    if (errors.length > 0) {
        expr.errors = errors;
    }

    return expr;
}
