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

import type { Driver } from "neo4j-driver";
import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import { gql } from "apollo-server";
import Neo4j from "../neo4j";
import { Neo4jGraphQL } from "../../../src/classes";
import { generateUniqueType, UniqueType } from "../../utils/graphql-types";
import { cleanNodes } from "../../utils/clean-nodes";

describe("@customResolver directive", () => {
    let driver: Driver;
    let neo4j: Neo4j;

    const user = {
        id: "An-ID",
        firstName: "someFirstName",
        lastName: "a second name!",
    };

    const testType = generateUniqueType("User");
    const customResolverField = "fullName";

    const typeDefs = `
        type ${testType} {
            id: ID!
            firstName: String!
            lastName: String!
            ${customResolverField}: String @customResolver(requires: "firstName lastName")
        }
    `;

    beforeAll(async () => {
        neo4j = new Neo4j();
        driver = await neo4j.getDriver();
    });

    afterAll(async () => {
        await driver.close();
    });

    describe("Scalar fields", () => {
        let schema: GraphQLSchema;

        const fullName = ({ firstName, lastName }) => `${firstName} ${lastName}`;

        const resolvers = {
            [testType.name]: { [customResolverField]: fullName },
        };

        beforeAll(async () => {
            const session = await neo4j.getSession();

            const neoSchema = new Neo4jGraphQL({ typeDefs, resolvers });
            schema = await neoSchema.getSchema();

            await session.run(
                `
                CREATE (user:${testType.name}) SET user = $user
            `,
                { user }
            );
            await session.close();
        });

        afterAll(async () => {
            const session = await neo4j.getSession();
            await session.run(`MATCH (n:${testType}) DETACH DELETE n`);
            await session.close();
        });

        test("removes a field from all but its object type, and resolves with a custom resolver", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        firstName
                        lastName
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                ...user,
                fullName: fullName(user),
            });
        });

        test("resolves field with custom resolver without required fields in selection set", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                id: user.id,
                fullName: fullName(user),
            });
        });

        test("resolves field with custom resolver with required field(s) aliased in selection set", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        f: firstName
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                id: user.id,
                f: user.firstName,
                fullName: fullName(user),
            });
        });
    });
    describe("Cypher fields", () => {
        const typeDefs = `
            type ${testType.name} {
                id: ID!
                firstName: String! @cypher(statement: "RETURN '${user.firstName}'")
                lastName: String! @cypher(statement: "RETURN '${user.lastName}'")
                fullName: String @customResolver(requires: "firstName lastName")
            }
        `;

        const fullName = ({ firstName, lastName }) => `${firstName} ${lastName}`;

        const resolvers = {
            [testType.name]: { [customResolverField]: fullName },
        };

        let schema: GraphQLSchema;

        beforeAll(async () => {
            const session = await neo4j.getSession();

            const neoSchema = new Neo4jGraphQL({ typeDefs, resolvers });
            schema = await neoSchema.getSchema();

            await session.run(
                `
                CREATE (user:${testType.name}) SET user.id = $userId
            `,
                { userId: user.id }
            );
            await session.close();
        });

        afterAll(async () => {
            const session = await neo4j.getSession();
            await session.run(`MATCH (n:${testType.name}) DETACH DELETE n`);
            await session.close();
        });

        test("removes a field from all but its object type, and resolves with a custom resolver", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        firstName
                        lastName
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                ...user,
                fullName: fullName(user),
            });
        });

        test("resolves field with custom resolver without required fields in selection set", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                id: user.id,
                fullName: fullName(user),
            });
        });

        test("resolves field with custom resolver with required field(s) aliased in selection set", async () => {
            const source = `
                query ${testType.name}($userId: ID!) {
                    ${testType.plural}(where: { id: $userId }) {
                        id
                        f: firstName
                        fullName
                    }
                }
            `;

            const gqlResult = await graphql({
                schema,
                source,
                contextValue: neo4j.getContextValues(),
                variableValues: { userId: user.id },
            });

            expect(gqlResult.errors).toBeFalsy();
            expect((gqlResult.data as any)[testType.plural][0]).toEqual({
                id: user.id,
                f: user.firstName,
                fullName: fullName(user),
            });
        });
    });
    describe("Custom resolver checks", () => {
        test("Check throws error if customResolver is not provided", async () => {
            const neoSchema = new Neo4jGraphQL({ typeDefs });
            await expect(async () => {
                await neoSchema.getSchema();
            }).rejects.toThrow(`Custom resolver for ${customResolverField} has not been provided`);
        });
        test("Check throws error if custom resolver defined for interface", async () => {
            const interfaceType = generateUniqueType("UserInterface");
            const typeDefs = `
                interface ${interfaceType.name} {
                    ${customResolverField}: String @customResolver(requires: "firstName lastName")
                }

                type ${testType} implements ${interfaceType.name} {
                    id: ID!
                    firstName: String!
                    lastName: String!
                    ${customResolverField}: String
                }
            `;

            const testResolver = () => "Some value";
            const resolvers = {
                [interfaceType.name]: {
                    [customResolverField]: testResolver,
                },
            };
            const neoSchema = new Neo4jGraphQL({ typeDefs, resolvers });
            await expect(async () => {
                await neoSchema.getSchema();
            }).rejects.toThrow(`Custom resolver for ${customResolverField} has not been provided`);
        });
    });
});

describe("Related Fields", () => {
    let driver: Driver;
    let neo4j: Neo4j;

    let Publication: UniqueType;
    let Author: UniqueType;
    let Book: UniqueType;
    let Journal: UniqueType;
    let User: UniqueType;
    let Address: UniqueType;
    let City: UniqueType;

    const userInput1 = {
        id: "1",
        firstName: "First",
        lastName: "Last",
    };
    const userInput2 = {
        id: "2",
        firstName: "New First",
        lastName: "new-last",
    };
    const addressInput1 = {
        city: "some city",
        street: "some street",
    };
    const addressInput2 = {
        city: "another-city",
        street: "another-street",
    };

    beforeAll(async () => {
        neo4j = new Neo4j();
        driver = await neo4j.getDriver();
    });

    beforeEach(() => {
        Publication = generateUniqueType("Publication");
        Author = generateUniqueType("Author");
        Book = generateUniqueType("Book");
        Journal = generateUniqueType("Journal");
        User = generateUniqueType("User");
        Address = generateUniqueType("Address");
        City = generateUniqueType("City");
    });

    afterEach(async () => {
        const session = await neo4j.getSession();
        try {
            await cleanNodes(session, [Publication, Author, Book, Journal, User, Address, City]);
        } finally {
            await session.close();
        }
    });

    afterAll(async () => {
        await driver.close();
    });

    test("should be able to require a field from a related type", async () => {
        const session = await neo4j.getSession();
        try {
            await session.run(
                `CREATE (user:${User})-[:LIVES_AT]->(addr:${Address}) SET user = $userInput1, addr = $addressInput1`,
                { userInput1, addressInput1 }
            );
        } finally {
            await session.close();
        }

        const typeDefs = gql`
            type ${Address} {
                street: String!
                city: String!
            }

            type ${User} {
                id: ID!
                firstName: String!
                lastName: String!
                address: ${Address} @relationship(type: "LIVES_AT", direction: OUT)
                fullName: String @customResolver(requires: "firstName lastName address { city }")
            }
        `;

        const fullNameResolver = ({ firstName, lastName, address }) => `${firstName} ${lastName} from ${address.city}`;

        const resolvers = {
            [User.name]: {
                fullName: fullNameResolver,
            },
        };

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            resolvers,
        });

        const query = `
            query ${User} {
                ${User.plural} {
                    fullName
                }
            }
        `;

        const result = await graphql({
            schema: await neoSchema.getSchema(),
            source: query,
            contextValue: neo4j.getContextValues(),
        });

        expect(result.errors).toBeFalsy();
        expect(result.data as any).toEqual({
            [User.plural]: [
                {
                    fullName: fullNameResolver({
                        firstName: userInput1.firstName,
                        lastName: userInput1.lastName,
                        address: { city: addressInput1.city },
                    }),
                },
            ],
        });
    });

    test("should fetch required fields when other fields are also selected", async () => {
        const session = await neo4j.getSession();
        try {
            await session.run(
                `CREATE (user:${User})-[:LIVES_AT]->(addr:${Address}) SET user = $userInput1, addr = $addressInput1`,
                { userInput1, addressInput1 }
            );
        } finally {
            await session.close();
        }

        const typeDefs = gql`
            type ${Address} {
                street: String!
                city: String!
            }

            type ${User} {
                id: ID!
                firstName: String!
                lastName: String!
                address: ${Address} @relationship(type: "LIVES_AT", direction: OUT)
                fullName: String @customResolver(requires: "firstName lastName address { city }")
            }
        `;

        const fullNameResolver = ({ firstName, lastName, address }) => `${firstName} ${lastName} from ${address.city}`;

        const resolvers = {
            [User.name]: {
                fullName: fullNameResolver,
            },
        };

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            resolvers,
        });

        const query = `
            query ${User} {
                ${User.plural} {
                    id
                    fullName
                    address {
                        street
                        city
                    }
                }
            }
        `;

        const result = await graphql({
            schema: await neoSchema.getSchema(),
            source: query,
            contextValue: neo4j.getContextValues(),
        });

        expect(result.errors).toBeFalsy();
        expect(result.data as any).toEqual({
            [User.plural]: [
                {
                    id: userInput1.id,
                    address: addressInput1,
                    fullName: fullNameResolver({
                        firstName: userInput1.firstName,
                        lastName: userInput1.lastName,
                        address: { city: addressInput1.city },
                    }),
                },
            ],
        });
    });

    test("should fetch customResolver fields over multiple users", async () => {
        const session = await neo4j.getSession();
        try {
            await session.run(
                `
                    CREATE (user1:${User})-[:LIVES_AT]->(addr1:${Address}) SET user1 = $userInput1, addr1 = $addressInput1
                    CREATE (user2:${User})-[:LIVES_AT]->(addr2:${Address}) SET user2 = $userInput2, addr2 = $addressInput2
                `,
                { userInput1, addressInput1, userInput2, addressInput2 }
            );
        } finally {
            await session.close();
        }

        const typeDefs = gql`
            type ${Address} {
                street: String!
                city: String!
            }

            type ${User} {
                id: ID!
                firstName: String!
                lastName: String!
                address: ${Address} @relationship(type: "LIVES_AT", direction: OUT)
                fullName: String @customResolver(requires: "firstName lastName address { city }")
            }
        `;

        const fullNameResolver = ({ firstName, lastName, address }) => `${firstName} ${lastName} from ${address.city}`;

        const resolvers = {
            [User.name]: {
                fullName: fullNameResolver,
            },
        };

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            resolvers,
        });

        const query = `
            query ${User} {
                ${User.plural} {
                    id
                    fullName
                    address {
                        street
                        city
                    }
                }
            }
        `;

        const result = await graphql({
            schema: await neoSchema.getSchema(),
            source: query,
            contextValue: neo4j.getContextValues(),
        });

        expect(result.errors).toBeFalsy();
        expect(result.data as any).toEqual({
            [User.plural]: expect.toIncludeSameMembers([
                {
                    id: userInput1.id,
                    address: addressInput1,
                    fullName: fullNameResolver({
                        firstName: userInput1.firstName,
                        lastName: userInput1.lastName,
                        address: { city: addressInput1.city },
                    }),
                },
                {
                    id: userInput2.id,
                    address: addressInput2,
                    fullName: fullNameResolver({
                        firstName: userInput2.firstName,
                        lastName: userInput2.lastName,
                        address: { city: addressInput2.city },
                    }),
                },
            ]),
        });
    });

    test("should select related fields when not selected last", async () => {
        const session = await neo4j.getSession();
        try {
            await session.run(
                `
                    CREATE (user1:${User})-[:LIVES_AT]->(addr1:${Address}) SET user1 = $userInput1, addr1 = $addressInput1
                    CREATE (user2:${User})-[:LIVES_AT]->(addr2:${Address}) SET user2 = $userInput2, addr2 = $addressInput2
                `,
                { userInput1, addressInput1, userInput2, addressInput2 }
            );
        } finally {
            await session.close();
        }

        const typeDefs = gql`
            type ${Address} {
                street: String!
                city: String!
            }

            type ${User} {
                id: ID!
                firstName: String!
                lastName: String!
                address: ${Address} @relationship(type: "LIVES_AT", direction: OUT)
                fullName: String @customResolver(requires: "firstName address { city } lastName")
            }
        `;

        const fullNameResolver = ({ firstName, lastName, address }) => `${firstName} ${lastName} from ${address.city}`;

        const resolvers = {
            [User.name]: {
                fullName: fullNameResolver,
            },
        };

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            resolvers,
        });

        const query = `
            query ${User} {
                ${User.plural} {
                    id
                    fullName
                    address {
                        street
                        city
                    }
                }
            }
        `;

        const result = await graphql({
            schema: await neoSchema.getSchema(),
            source: query,
            contextValue: neo4j.getContextValues(),
        });

        expect(result.errors).toBeFalsy();
        expect(result.data as any).toEqual({
            [User.plural]: expect.toIncludeSameMembers([
                {
                    id: userInput1.id,
                    address: addressInput1,
                    fullName: fullNameResolver({
                        firstName: userInput1.firstName,
                        lastName: userInput1.lastName,
                        address: { city: addressInput1.city },
                    }),
                },
                {
                    id: userInput2.id,
                    address: addressInput2,
                    fullName: fullNameResolver({
                        firstName: userInput2.firstName,
                        lastName: userInput2.lastName,
                        address: { city: addressInput2.city },
                    }),
                },
            ]),
        });
    });
});
