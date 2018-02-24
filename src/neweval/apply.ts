import { doEval } from "./eval2";
import { ProcedureDetails, FunctionDetails } from "./procs";
import { unbox, boxValue, BoxType, Box } from "./box";
import { JEnv } from "./environment";
import { Signature } from "../signatures";
import { unexpectedValue } from "../utils";

/**
 * Apply procedure or function
 * @param {Object} proc - Procedure
 * @param {Array} args - Arguments
 * @param {Object} self - Self
 * @returns {*} Result of procedure
 */
export function apply(proc: Box, args: Box[], context: Box): Box {
    let result = applyInner(proc, args, context);

    // As long as this is a lambda AND it has a thunk, we continue in this loop.
    // First we establish if it is a lambda (which allows us to extract the
    // ProcedureDetails) and then we determine if it is a thunk.
    while (result.type === BoxType.Lambda) {
        let details = result.values[0] as ProcedureDetails;
        if (details.thunk) {
            let body = details.body;
            if (body.type === "function" || body.type === "partial") {
                let node = body;
                // trampoline loop - this gets invoked as a result of tail-call optimization
                // the function returned a tail-call thunk
                // unpack it, evaluate its arguments, and apply the tail call
                var next = doEval(node.procedure, details.input, details.environment);
                var evaluatedArgs = [];
                for (var ii = 0; ii < node.arguments.length; ii++) {
                    evaluatedArgs.push(doEval(node.arguments[ii], details.input, details.environment));
                }
            } else {
                throw new Error("body in ProcedureDetails was not a FunctionInvocationNode");
            }

            result = applyInner(next, evaluatedArgs, context);
        } else {
            // Turns out it wasn't a thunk, so just return what we have.
            break;
        }
    }
    return result;
}

/**
 * Apply procedure (ProcedureDetails) or function
 * @param {Object} proc - Procedure
 * @param {Array} args - Arguments
 * @param {Object} self - Self
 * @returns {*} Result of procedure
 */
function applyInner(proc: Box, args: Box[], context: Box): Box {
    var validatedArgs = args;

    switch (proc.type) {
        case BoxType.Lambda: {
            let details = proc.values[0] as ProcedureDetails;
            validatedArgs = validateArguments(details.signature, args, context);
            return applyProcedure(details, validatedArgs);
        }
        case BoxType.Function: {
            let details = proc.values[0] as FunctionDetails;
            let self = unbox(context);
            return details.implementation.apply(self, validatedArgs);
        }
        case BoxType.Array:
        case BoxType.Value: {
            let f = unbox(proc);
            let self = unbox(context);
            if (typeof f === "function") {
                return f.apply(self, validatedArgs);
            } else {
                throw {
                    code: "T1006",
                    stack: new Error().stack,
                };
            }
        }
        default: {
            return unexpectedValue<Box>(
                proc,
                proc,
                v => "applyInner failed to handle case where result type was " + v.type,
            );
        }
    }
}

/**
 * Validate the arguments against the signature validator (if it exists)
 * @param {Function} signature - validator function
 * @param {Array} args - function arguments
 * @param {*} context - context value
 * @returns {Array} - validated arguments
 */
function validateArguments(signature: Signature, args: Box[], context: Box): Box[] {
    if (typeof signature === "undefined") {
        // nothing to validate
        return args;
    }
    var validatedArgs = signature.validate(args.map(v => unbox(v)), context);
    return validatedArgs.map(x => boxValue(x));
}

/**
 * Apply procedure
 * @param {Object} proc - Procedure
 * @param {Array} args - Arguments
 * @returns {*} Result of procedure
 */
function applyProcedure(details: ProcedureDetails, args: Box[]) {
    let env = new JEnv();

    details.arguments.forEach((param, index) => {
        env.bindBox(param.value, args[index]);
    });
    if (typeof details.body === "function") {
        // this is a lambda that wraps a native function - generated by partially evaluating a native
        return applyNativeFunction(details.body, env);
    } else {
        return doEval(details.body, details.input, env);
    }
}

/**
 * Apply native function
 * @param {Object} proc - Procedure
 * @param {Object} env - Environment
 * @returns {*} Result of applying native function
 */
function applyNativeFunction(f: Function, env: JEnv) {
    var sigArgs = getNativeFunctionArguments(f);
    // generate the array of arguments for invoking the function - look them up in the environment
    var args = sigArgs.map(function(sigArg) {
        return env.lookup(sigArg.trim());
    });

    return f.apply(null, args);
}

/**
 * Get native function arguments
 * @param {Function} func - Function
 * @returns {*|Array} Native function arguments
 */
function getNativeFunctionArguments(func: Function) {
    var signature = func.toString();
    var sigParens = /\(([^)]*)\)/.exec(signature)[1]; // the contents of the parens
    var sigArgs = sigParens.split(",");
    return sigArgs;
}
