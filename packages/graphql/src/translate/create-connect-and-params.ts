/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Cypher, { and } from "@neo4j/cypher-builder";
import type { Node, Relationship } from "../classes";
import type { RelationField, Context } from "../types";
import createWhereAndParams from "./where/create-where-and-params";
import { createAuthAndParams, createAuthPredicates } from "./create-auth-and-params";
import { AUTH_FORBIDDEN_ERROR } from "../constants";
import createSetRelationshipPropertiesAndParams from "./create-set-relationship-properties-and-params";
import createRelationshipValidationString from "./create-relationship-validation-string";
import type { CallbackBucket } from "../classes/CallbackBucket";
import { createConnectionEventMetaObject } from "./subscriptions/create-connection-event-meta";
import { filterMetaVariable } from "./subscriptions/filter-meta-variable";
import { createWherePredicate } from "./where/create-where-predicate";

function createConnectAndParams({
    withVars,
    value,
    varName,
    relationField,
    parentVar,
    refNodes,
    context,
    callbackBucket,
    labelOverride,
    parentNode,
    fromCreate,
    insideDoWhen,
    includeRelationshipValidation,
    isFirstLevel = true,
}: {
    withVars: string[];
    value: any;
    varName: string;
    relationField: RelationField;
    parentVar: string;
    context: Context;
    callbackBucket: CallbackBucket;
    refNodes: Node[];
    labelOverride?: string;
    parentNode: Node;
    fromCreate?: boolean;
    insideDoWhen?: boolean;
    includeRelationshipValidation?: boolean;
    isFirstLevel?: boolean;
}): Cypher.Clause {
    const namedWithVars = withVars.map((withVar) => new Cypher.NamedVariable(withVar));
    const metaFilteredVars = filterMetaVariable(withVars).map((withVar) => new Cypher.NamedVariable(withVar));

    function createSubqueryContents(
        relatedNode: Node,
        connect: any,
        index: number
    ): { subquery: string; params: Record<string, any> } {
        let params = {};
        const nodeRef = new Cypher.NamedNode(varName);
        const parentNodeRef = new Cypher.NamedNode(parentVar);
        const relationship = new Cypher.Variable();
        const metaVar = new Cypher.NamedVariable("meta");
        const labels = relatedNode.getLabelString(context);
        const overriddenLabels = labelOverride ? `:${labelOverride}` : labels;

        nodeRef.hasLabels(overriddenLabels);

        const matchClause = new Cypher.OptionalMatch(nodeRef);

        matchClause.with(...namedWithVars);
        if (context.subscriptionsEnabled) {
            matchClause.with(...metaFilteredVars, [new Cypher.RawCypher("[]"), metaVar]);
        }

        if (connect.where) {
            // If _on is the only where key and it doesn't contain this implementation, don't connect it
            if (
                connect.where.node._on &&
                Object.keys(connect.where.node).length === 1 &&
                !Object.prototype.hasOwnProperty.call(connect.where.node._on, relatedNode.name)
            ) {
                return { subquery: "", params: {} };
            }

            const rootNodeWhereAndParams = createWherePredicate({
                targetElement: nodeRef,
                whereInput: {
                    ...Object.entries(connect.where.node).reduce((args, [k, v]) => {
                        if (k !== "_on") {
                            // If this where key is also inside _on for this implementation, use the one in _on instead
                            if (connect.where.node?._on?.[relatedNode.name]?.[k]) {
                                return args;
                            }
                            return { ...args, [k]: v };
                        }

                        return args;
                    }, {}),
                },
                context,
                element: relatedNode,
            });
            if (rootNodeWhereAndParams) {
                matchClause.where(rootNodeWhereAndParams);
            }

            // For _on filters
            if (connect.where.node?._on?.[relatedNode.name]) {
                const onTypeNodeWhereAndParams = createWherePredicate({
                    targetElement: nodeRef,
                    whereInput: {
                        ...Object.entries(connect.where.node).reduce((args, [k, v]) => {
                            if (k !== "_on") {
                                return { ...args, [k]: v };
                            }

                            if (Object.prototype.hasOwnProperty.call(v, relatedNode.name)) {
                                return { ...args, ...(v as any)[relatedNode.name] };
                            }

                            return args;
                        }, {}),
                    },
                    context,
                    element: relatedNode,
                });
                if (onTypeNodeWhereAndParams) {
                    matchClause.where(onTypeNodeWhereAndParams);
                }
            }
        }

        if (relatedNode.auth) {
            // const whereAuth = createAuthAndParams({
            //     operations: "CONNECT",
            //     entity: relatedNode,
            //     context,
            //     where: { varName: nodeName, node: relatedNode },
            // });
            // if (whereAuth[0]) {
            //     whereStrs.push(whereAuth[0]);
            //     params = { ...params, ...whereAuth[1] };
            // }
            const authPredicate = createAuthPredicates({
                entity: relatedNode,
                operations: "CONNECT",
                context,
                where: { varName: nodeRef, node: relatedNode },
            });
            if (authPredicate) {
                matchClause.where(authPredicate);
            }
        }

        const nodeMatrix: Array<{ node: Node; nodeRef: Cypher.Node }> = [{ node: relatedNode, nodeRef }];
        if (!fromCreate) nodeMatrix.push({ node: parentNode, nodeRef: parentNodeRef });

        const preAuth = nodeMatrix.reduce((result: Cypher.Predicate[], { node, nodeRef }, i) => {
            if (!node.auth) {
                return result;
            }

            // const [str, p] = createAuthAndParams({
            //     entity: node,
            //     operations: "CONNECT",
            //     context,
            //     escapeQuotes: Boolean(insideDoWhen),
            //     allow: { parentNode: node, varName: name, chainStr: `${name}${node.name}${i}_allow` },
            // });

            const authPredicate = createAuthPredicates({
                entity: node,
                operations: "CONNECT",
                context,
                escapeQuotes: Boolean(insideDoWhen),
                allow: {
                    parentNode: node,
                    varName: nodeRef,
                    chainStr: new Cypher.RawCypher(
                        (env) => `${env.getReferenceId(nodeRef)}${node.name}${i}_allow`
                    ).build().cypher,
                },
            });

            if (!authPredicate) {
                return result;
            }

            result.push(authPredicate);
            return result;
        }, []);

        if (preAuth.length) {
            const quote = insideDoWhen ? `\\"` : `"`;
            const authClauses = preAuth.map(
                (predicate) => new Cypher.apoc.ValidatePredicate(predicate, `${quote}${AUTH_FORBIDDEN_ERROR}${quote}`)
            );
            matchClause.where(Cypher.and(...authClauses));
        }

        /*
           TODO
           Replace with subclauses https://neo4j.com/developer/kb/conditional-cypher-execution/
           https://neo4j.slack.com/archives/C02PUHA7C/p1603458561099100
        */
        // const subquery = new Cypher.Call()
        const connectedNodesVar = new Cypher.NamedVariable("connectedNodes");
        const parentNodesVar = new Cypher.NamedVariable("parentNodes");
        const outerWithClause = new Cypher.With(
            [Cypher.collect(nodeRef), connectedNodesVar],
            [Cypher.collect(parentNodeRef), parentNodesVar]
        );
        // subquery.push("\tCALL {");
        // subquery.push("\t\tWITH *");
        // const withVarsInner = [
        //     ...withVars.filter((v) => v !== parentVar),
        //     `collect(${nodeName}) as connectedNodes`,
        //     `collect(${parentVar}) as parentNodes`,
        // ];
        if (context.subscriptionsEnabled) {
            outerWithClause.with(...metaFilteredVars, [new Cypher.RawCypher("[]"), metaVar]);
        }

        // subquery.push(`\t\tWITH ${filterMetaVariable(withVarsInner).join(", ")}`);

        const innerWithClause = new Cypher.Unwind([connectedNodesVar, nodeRef], [parentNodesVar, nodeRef]);
        innerWithClause.with(connectedNodesVar, parentNodesVar);

        // subquery.push("\t\tCALL {"); //
        // subquery.push("\t\t\tWITH connectedNodes, parentNodes"); //
        // subquery.push(`\t\t\tUNWIND parentNodes as ${parentVar}`);
        // subquery.push(`\t\t\tUNWIND connectedNodes as ${nodeName}`);

        const relationshipPattern = new Cypher.Relationship({
            source: nodeRef,
            target: parentNodeRef,
            type: relationField.type,
        });
        let mergeOrCreateClause: Cypher.Clause;
        let setA: Cypher.RawCypher | undefined;

        if (connect.createAsDuplicate) {
            mergeOrCreateClause = new Cypher.RawCypher((env) => `CREATE ${relationship.getCypher(env)}`);
        } else {
            mergeOrCreateClause = new Cypher.Merge(relationshipPattern);
        }

        if (relationField.properties) {
            const relationship = context.relationships.find(
                (x) => x.properties === relationField.properties
            ) as unknown as Relationship;
            setA = new Cypher.RawCypher(
                createSetRelationshipPropertiesAndParams({
                    properties: connect.edge ?? {},
                    varName: relationshipPattern.pattern.name,
                    relationship,
                    operation: "CREATE",
                    callbackBucket,
                })[0]
            ); // TODO fix this

            // subquery.push(`\t\t\t${setA[0]}`);
            // params = { ...params, ...setA[1] };
        }

        let innerSubquery: Cypher.Return;
        const updateMetaVar = new Cypher.NamedVariable("update_meta");

        if (context.subscriptionsEnabled) {
            const [fromVariable, toVariable] =
                relationField.direction === "IN" ? [varName, parentVar] : [parentVar, varName];
            const [fromTypename, toTypename] =
                relationField.direction === "IN"
                    ? [relatedNode.name, parentNode.name]
                    : [parentNode.name, relatedNode.name];
            const eventWithMetaStr = createConnectionEventMetaObject({
                event: "connect",
                relVariable: "relationshipVar", // TODO fix this
                fromVariable,
                toVariable,
                typename: relationField.type,
                fromTypename,
                toTypename,
            });
            const eventMetaWithClause = new Cypher.With([new Cypher.RawCypher(eventWithMetaStr), metaVar]);
            innerSubquery = new Cypher.Call(
                Cypher.concat(innerWithClause, mergeOrCreateClause, setA, eventMetaWithClause)
            ).return([Cypher.collect(metaVar), updateMetaVar]);
        } else {
            innerSubquery = new Cypher.Call(Cypher.concat(innerWithClause, mergeOrCreateClause, setA)).return([
                Cypher.collect(new Cypher.RawCypher("*")),
                new Cypher.NamedVariable("_"),
            ]);
        }

        let outerSubquery: Cypher.Return;

        // subquery.push("\t\t}");

        if (context.subscriptionsEnabled) {
        //     subquery.push(`\t\tWITH meta + update_meta as meta`);
        //     subquery.push(`\t\tRETURN meta AS connect_meta`);
        //     subquery.push("\t}");
            const finalWith = new Cypher.With(
                [new Cypher.RawCypher(env => `${metaVar.getCypher(env)}  ${updateMetaVar.getCypher(env)}`), new Cypher.NamedVariable("*")]
            );
            outerSubquery = new Cypher.Call(Cypher.concat(outerWithClause, innerSubquery, finalWith)).return([
                Cypher.collect(metaVar),
                new Cypher.NamedVariable("connect_meta"),
            ]);
        } else {
            outerSubquery = new Cypher.Call(Cypher.concat(outerWithClause, innerSubquery)).return([
                Cypher.count(new Cypher.RawCypher("*")),
                new Cypher.NamedVariable("_"),
            ]);
        }

        let innerMetaStr = "";
        if (context.subscriptionsEnabled) {
            innerMetaStr = `, connect_meta + meta AS meta`;
        }

        if (includeRelationshipValidation) {
            const relValidationStrs: string[] = [];
            const matrixItems = [
                [parentNode, parentVar],
                [relatedNode, nodeName],
            ] as [Node, string][];

            matrixItems.forEach((mi) => {
                const relValidationStr = createRelationshipValidationString({
                    node: mi[0],
                    context,
                    varName: mi[1],
                });
                if (relValidationStr) {
                    relValidationStrs.push(relValidationStr);
                }
            });

            if (relValidationStrs.length) {
                subquery.push(`\tWITH ${[...filterMetaVariable(withVars), nodeName].join(", ")}${innerMetaStr}`);
                subquery.push(relValidationStrs.join("\n"));
            }
        }

        subquery.push(`WITH ${[...filterMetaVariable(withVars), nodeName].join(", ")}${innerMetaStr}`);

        if (connect.connect) {
            const connects = (Array.isArray(connect.connect) ? connect.connect : [connect.connect]) as any[];

            connects.forEach((c) => {
                const reduced = Object.entries(c)
                    .filter(([k]) => {
                        if (k === "_on") {
                            return false;
                        }

                        if (relationField.interface && c?._on?.[relatedNode.name]) {
                            const onArray = Array.isArray(c._on[relatedNode.name])
                                ? c._on[relatedNode.name]
                                : [c._on[relatedNode.name]];
                            if (onArray.some((onKey) => Object.prototype.hasOwnProperty.call(onKey, k))) {
                                return false;
                            }
                        }

                        return true;
                    })
                    .reduce(
                        (r: Res, [k, v]: [string, any]) => {
                            const relField = relatedNode.relationFields.find((x) => k === x.fieldName) as RelationField;
                            const newRefNodes: Node[] = [];

                            if (relField.union) {
                                Object.keys(v).forEach((modelName) => {
                                    newRefNodes.push(context.nodes.find((x) => x.name === modelName) as Node);
                                });
                            } else if (relField.interface) {
                                (relField.interface.implementations as string[]).forEach((modelName) => {
                                    newRefNodes.push(context.nodes.find((x) => x.name === modelName) as Node);
                                });
                            } else {
                                newRefNodes.push(context.nodes.find((x) => x.name === relField.typeMeta.name) as Node);
                            }

                            newRefNodes.forEach((newRefNode) => {
                                const recurse = createConnectAndParams({
                                    withVars: [...withVars, nodeName],
                                    value: relField.union ? v[newRefNode.name] : v,
                                    varName: `${nodeName}_${k}${relField.union ? `_${newRefNode.name}` : ""}`,
                                    relationField: relField,
                                    parentVar: nodeName,
                                    context,
                                    callbackBucket,
                                    refNodes: [newRefNode],
                                    parentNode: relatedNode,
                                    labelOverride: relField.union ? newRefNode.name : "",
                                    includeRelationshipValidation: true,
                                    isFirstLevel: false,
                                });
                                r.connects.push(recurse[0]);
                                r.params = { ...r.params, ...recurse[1] };
                            });

                            return r;
                        },
                        { connects: [], params: {} }
                    );

                subquery.push(reduced.connects.join("\n"));
                params = { ...params, ...reduced.params };

                if (relationField.interface && c?._on?.[relatedNode.name]) {
                    const onConnects = Array.isArray(c._on[relatedNode.name])
                        ? c._on[relatedNode.name]
                        : [c._on[relatedNode.name]];

                    onConnects.forEach((onConnect, onConnectIndex) => {
                        const onReduced = Object.entries(onConnect).reduce(
                            (r: Res, [k, v]: [string, any]) => {
                                const relField = relatedNode.relationFields.find((x) =>
                                    k.startsWith(x.fieldName)
                                ) as RelationField;
                                const newRefNodes: Node[] = [];

                                if (relField.union) {
                                    Object.keys(v).forEach((modelName) => {
                                        newRefNodes.push(context.nodes.find((x) => x.name === modelName) as Node);
                                    });
                                } else {
                                    newRefNodes.push(
                                        context.nodes.find((x) => x.name === relField.typeMeta.name) as Node
                                    );
                                }

                                newRefNodes.forEach((newRefNode) => {
                                    const recurse = createConnectAndParams({
                                        withVars: [...withVars, nodeName],
                                        value: relField.union ? v[newRefNode.name] : v,
                                        varName: `${nodeName}_on_${relatedNode.name}${onConnectIndex}_${k}`,
                                        relationField: relField,
                                        parentVar: nodeName,
                                        context,
                                        callbackBucket,
                                        refNodes: [newRefNode],
                                        parentNode: relatedNode,
                                        labelOverride: relField.union ? newRefNode.name : "",
                                        isFirstLevel: false,
                                    });
                                    r.connects.push(recurse[0]);
                                    r.params = { ...r.params, ...recurse[1] };
                                });

                                return r;
                            },
                            { connects: [], params: {} }
                        );
                        subquery.push(onReduced.connects.join("\n"));
                        params = { ...params, ...onReduced.params };
                    });
                }
            });
        }

        const postAuth = [...(!fromCreate ? [parentNode] : []), relatedNode].reduce(
            (result: Res, node, i) => {
                if (!node.auth) {
                    return result;
                }

                const [str, p] = createAuthAndParams({
                    entity: node,
                    operations: "CONNECT",
                    context,
                    escapeQuotes: Boolean(insideDoWhen),
                    skipIsAuthenticated: true,
                    skipRoles: true,
                    bind: { parentNode: node, varName: nodeName, chainStr: `${nodeName}${node.name}${i}_bind` },
                });

                if (!str) {
                    return result;
                }

                result.connects.push(str);
                result.params = { ...result.params, ...p };

                return result;
            },
            { connects: [], params: {} }
        );

        if (postAuth.connects.length) {
            const quote = insideDoWhen ? `\\"` : `"`;
            subquery.push(`\tWITH ${[...withVars, nodeName].join(", ")}`);
            subquery.push(
                `\tCALL apoc.util.validate(NOT (${postAuth.connects.join(
                    " AND "
                )}), ${quote}${AUTH_FORBIDDEN_ERROR}${quote}, [0])`
            );
            params = { ...params, ...postAuth.params };
        }

        if (context.subscriptionsEnabled) {
            subquery.push(`WITH collect(meta) AS connect_meta`);
            subquery.push(`RETURN REDUCE(m=[],m1 IN connect_meta | m+m1 ) as connect_meta`);
        } else {
            subquery.push(`\tRETURN count(*) AS connect_${varName}_${relatedNode.name}`);
        }

        return { subquery: subquery.join("\n"), params };
    }

    function reducer(res: Res, connect: any, index: number): Res {
        if (parentNode.auth && !fromCreate) {
            const whereAuth = createAuthAndParams({
                operations: "CONNECT",
                entity: parentNode,
                context,
                where: { varName: parentVar, node: parentNode },
            });
            if (whereAuth[0]) {
                res.connects.push(`WITH ${withVars.join(", ")}`);
                res.connects.push(`WHERE ${whereAuth[0]}`);
                res.params = { ...res.params, ...whereAuth[1] };
            }
        }

        if (isFirstLevel) {
            res.connects.push(`WITH ${withVars.join(", ")}`);
        }

        const inner: string[] = [];
        if (relationField.interface) {
            const subqueries: string[] = [];
            refNodes.forEach((refNode, i) => {
                const subquery = createSubqueryContents(refNode, connect, i);
                if (subquery.subquery) {
                    subqueries.push(subquery.subquery);
                    res.params = { ...res.params, ...subquery.params };
                }
            });
            if (subqueries.length > 0) {
                if (context.subscriptionsEnabled) {
                    const withStatement = `WITH ${filterMetaVariable(withVars).join(
                        ", "
                    )}, connect_meta + meta AS meta`;
                    inner.push(subqueries.join(`\n}\n${withStatement}\nCALL {\n\t`));
                } else {
                    inner.push(subqueries.join("\n}\nCALL {\n\t"));
                }
            }
        } else {
            const subquery = createSubqueryContents(refNodes[0], connect, index);
            inner.push(subquery.subquery);
            res.params = { ...res.params, ...subquery.params };
        }

        if (inner.length > 0) {
            res.connects.push("CALL {");
            res.connects.push(...inner);
            res.connects.push("}");

            if (context.subscriptionsEnabled) {
                res.connects.push(`WITH connect_meta + meta AS meta, ${filterMetaVariable(withVars).join(", ")}`);
            }
        }

        return res;
    }

    const { connects, params } = ((relationField.typeMeta.array ? value : [value]) as any[]).reduce(reducer, {
        connects: [],
        params: {},
    });

    return [connects.join("\n"), params];
}

export default createConnectAndParams;
