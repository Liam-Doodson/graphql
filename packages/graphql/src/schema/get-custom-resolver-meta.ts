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

import type { IResolvers } from "@graphql-tools/utils";
import type {
    FieldDefinitionNode,
    StringValueNode,
    InterfaceTypeDefinitionNode,
    ObjectTypeDefinitionNode,
    DocumentNode,
    SelectionSetNode,
    TypeNode,
    UnionTypeDefinitionNode,
} from "graphql";
import { Kind, parse } from "graphql";
import type { FieldsByTypeName, ResolveTree } from "graphql-parse-resolve-info";
import { generateResolveTree } from "../translate/utils/resolveTree";
import { removeDuplicates } from "../utils/utils";

type CustomResolverMeta = {
    requiredFields: Record<string, ResolveTree>;
};

const DEPRECATION_WARNING =
    "The @computed directive has been deprecated and will be removed in version 4.0.0. Please use " +
    "the @customResolver directive instead. More information can be found at " +
    "https://neo4j.com/docs/graphql-manual/current/guides/v4-migration/#_computed_renamed_to_customresolver.";
const INVALID_SELECTION_SET_ERROR = "Invalid selection set passed to @customResolver required";
export const DEPRECATED_ERROR_MESSAGE = "Required fields of @customResolver must be a list of strings";

let deprecationWarningShown = false;

export default function getCustomResolverMeta({
    field,
    object,
    objects,
    interfaces,
    unions,
    customResolvers,
    interfaceField,
}: {
    field: FieldDefinitionNode;
    object: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode;
    objects: ObjectTypeDefinitionNode[];
    interfaces: InterfaceTypeDefinitionNode[];
    unions: UnionTypeDefinitionNode[];
    customResolvers?: IResolvers | IResolvers[];
    interfaceField?: FieldDefinitionNode;
}): CustomResolverMeta | undefined {
    const deprecatedDirective =
        field.directives?.find((x) => x.name.value === "computed") ||
        interfaceField?.directives?.find((x) => x.name.value === "computed");

    if (deprecatedDirective && !deprecationWarningShown) {
        console.warn(DEPRECATION_WARNING);
        deprecationWarningShown = true;
    }

    const directive =
        field.directives?.find((x) => x.name.value === "customResolver") ||
        interfaceField?.directives?.find((x) => x.name.value === "customResolver");

    if (!directive && !deprecatedDirective) {
        return undefined;
    }

    // TODO: remove check for directive when removing @computed
    if (object.kind !== Kind.INTERFACE_TYPE_DEFINITION && directive && !customResolvers?.[field.name.value]) {
        throw new Error(`Custom resolver for ${field.name.value} has not been provided`);
    }

    const directiveFromArgument =
        directive?.arguments?.find((arg) => arg.name.value === "requires") ||
        deprecatedDirective?.arguments?.find((arg) => arg.name.value === "from");

    if (!directiveFromArgument) {
        return undefined;
    }

    if (directiveFromArgument?.value.kind === Kind.STRING) {
        const selectionSetDocument = parse(`{ ${directiveFromArgument.value.value} }`);
        const requiredFieldsResolveTree = selectionSetToResolveTree(
            object.fields || [],
            objects,
            interfaces,
            unions,
            selectionSetDocument
        );
        if (requiredFieldsResolveTree) {
            return {
                requiredFields: requiredFieldsResolveTree,
            };
        }
    }

    // TODO - remove this when requires no longer requires a list
    if (directiveFromArgument?.value.kind === Kind.LIST) {
        const requiredFields = removeDuplicates(
            directiveFromArgument.value.values.map((v) => (v as StringValueNode).value) ?? []
        );
        const selectionSetDocument = parse(`{ ${requiredFields.join(" ")} }`);
        const requiredFieldsResolveTree = selectionSetToResolveTree(
            object.fields || [],
            objects,
            interfaces,
            unions,
            selectionSetDocument
        );
        if (requiredFieldsResolveTree) {
            return {
                requiredFields: requiredFieldsResolveTree,
            };
        }
    }

    return undefined;
}

function selectionSetToResolveTree(
    objectFields: ReadonlyArray<FieldDefinitionNode>,
    objects: ObjectTypeDefinitionNode[],
    interfaces: InterfaceTypeDefinitionNode[],
    unions: UnionTypeDefinitionNode[],
    document: DocumentNode
) {
    if (document.definitions.length !== 1) {
        throw new Error(INVALID_SELECTION_SET_ERROR);
    }

    const selectionSetDocument = document.definitions[0];
    if (selectionSetDocument.kind !== Kind.OPERATION_DEFINITION) {
        throw new Error(INVALID_SELECTION_SET_ERROR);
    }

    return nestedSelectionSetToResolveTrees(
        objectFields,
        objects,
        interfaces,
        unions,
        selectionSetDocument.selectionSet
    );
}

function nestedSelectionSetToResolveTrees(
    object: ReadonlyArray<FieldDefinitionNode>,
    objects: ObjectTypeDefinitionNode[],
    interfaces: InterfaceTypeDefinitionNode[],
    unions: UnionTypeDefinitionNode[],
    selectionSet: SelectionSetNode
): Record<string, ResolveTree>;
function nestedSelectionSetToResolveTrees(
    object: ReadonlyArray<FieldDefinitionNode>,
    objects: ObjectTypeDefinitionNode[],
    interfaces: InterfaceTypeDefinitionNode[],
    unions: UnionTypeDefinitionNode[],
    selectionSet: SelectionSetNode,
    outerFieldType: string
): FieldsByTypeName;
function nestedSelectionSetToResolveTrees(
    objectFields: ReadonlyArray<FieldDefinitionNode>,
    objects: ObjectTypeDefinitionNode[],
    interfaces: InterfaceTypeDefinitionNode[],
    unions: UnionTypeDefinitionNode[],
    selectionSet: SelectionSetNode,
    outerFieldType?: string
): Record<string, ResolveTree> | FieldsByTypeName {
    // TODO - handle aliases
    const result = selectionSet.selections.reduce((acc, selection) => {
        let nestedResolveTree = {};
        if (selection.kind === Kind.FRAGMENT_SPREAD) {
            // Support for these can be added later if there is time
            throw new Error("Fragment spreads are not supported in customResolver requires");
        }
        if (selection.kind === Kind.INLINE_FRAGMENT) {
            if (!selection.selectionSet) {
                return acc;
            }
            const nestedResolveTree = nestedSelectionSetToResolveTrees(
                objectFields,
                objects,
                interfaces,
                unions,
                selection.selectionSet
            );
            const fieldType = selection.typeCondition?.name.value;
            if (!fieldType) {
                throw new Error("Cannot find fragment type");
            }
            return {
                ...acc,
                [fieldType]: nestedResolveTree,
            };
        }
        if (selection.selectionSet) {
            const field = objectFields.find((field) => field.name.value === selection.name.value);
            const fieldType = getNestedType(field?.type);
            const unionImplementations = unions.find((union) => union.name.value === fieldType)?.types;
            const innerObjectFields =
                [...objects, ...interfaces].find((obj) => obj.name.value === fieldType)?.fields ||
                unionImplementations?.flatMap(
                    (implementation) =>
                        [...objects, ...interfaces].find((obj) => obj.name.value === implementation.name.value)
                            ?.fields || []
                );
            if (!innerObjectFields) {
                throw new Error(); // TODO - message
            }
            nestedResolveTree = nestedSelectionSetToResolveTrees(
                innerObjectFields,
                objects,
                interfaces,
                unions,
                selection.selectionSet,
                fieldType
            );
        }
        if (outerFieldType) {
            return {
                ...acc,
                [outerFieldType]: {
                    ...acc[outerFieldType],
                    ...generateResolveTree({
                        name: selection.name.value,
                        fieldsByTypeName: nestedResolveTree,
                    }),
                },
            };
        }
        return {
            ...acc,
            ...generateResolveTree({
                name: selection.name.value,
                fieldsByTypeName: nestedResolveTree,
            }),
        };
    }, {});
    return result;
}

function getNestedType(type: TypeNode | undefined): string {
    if (!type) {
        // TODO - better error message
        throw new Error("Cannot find the type of a related field that is required by a custom resolver");
    }
    if (type.kind !== Kind.NAMED_TYPE) {
        return getNestedType(type.type);
    }
    return type.name.value;
}
