import * as ast from "../ast";
import { Box, boxType, unbox } from "./box";

export interface KeyData {
    itemIndices: number[];
    groupIndex: number;
}

export interface ItemMatching {
    item: Box;
    keys: Box[];
}

export function evaluateGroup(groupings: ast.Groupings, data: ItemMatching[]): { [key: string]: KeyData } {
    let result: { [key: string]: KeyData } = {};

    // We loop first over all inputs and for each input we evaluate the expression
    // for the keys in the object constructor.  Then, we make a record of all input
    // values associated with each key and the value expression we will use to
    // evaluate them.
    data.forEach((d, itemIndex) => {
        // Next, we loop over the pairs of key and value
        groupings.forEach((grouping, groupIndex) => {
            // TODO: Convert this array to an object so we can refer to this by
            // rather than by index.
            let keyExpr = grouping.key;
            let keyBox = d.keys[groupIndex];

            // If the key isn't a boxed scalar string, then this is an error
            // TODO: Perhaps just a single string value is enough...scalar too strict?
            if (!boxType(keyBox, "string")) {
                throw {
                    code: "T1003",
                    stack: new Error().stack,
                    position: grouping.key.position,
                    value: keyBox,
                };
            }
            // Extract the actual string value
            let key = unbox(keyBox) as string;

            if (result.hasOwnProperty(key)) {
                let entry = result[key];

                if (entry.groupIndex != groupIndex) {
                    // this key has been generated by another expression in this group
                    // per issue #163 (https://github.com/jsonata-js/jsonata/issues/163),
                    // this is a semantic error.
                    throw {
                        code: "D1009",
                        stack: new Error().stack,
                        position: keyExpr.position,
                        value: key,
                    };
                }
                entry.itemIndices.push(itemIndex);
            } else {
                result[key] = {
                    itemIndices: [itemIndex],
                    groupIndex: groupIndex,
                };
            }
        });
    });

    return result;
}
