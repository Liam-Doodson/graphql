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
import { graphql } from "graphql";
import Neo4j from "../../neo4j";
import { Neo4jGraphQL } from "../../../../src/classes";
import { generateUniqueType, UniqueType } from "../../../utils/graphql-types";

describe("Connect inputs when using connectAsDuplicate argument", () => {
    let driver: Driver;
    let neo4j: Neo4j;

    const movieTitle = "A movie title";
    const showName = "some-show";
    const actorName1 = "An Actor";
    const actorName2 = "Name";
    const screenTime1 = 321;
    const screenTime2 = 2;
    const runTime = 104718;

    beforeAll(async () => {
        neo4j = new Neo4j();
        driver = await neo4j.getDriver();
    });

    afterAll(async () => {
        await driver.close();
    });

    describe("Regular Nodes", () => {
        let movieType: UniqueType;
        let actorType: UniqueType;
        let actedInInterface: UniqueType;

        beforeEach(() => {
            movieType = generateUniqueType("Movie");
            actorType = generateUniqueType("Actor");
            actedInInterface = generateUniqueType("ActedIn");
        });

        afterEach(async () => {
            const session = await neo4j.getSession();

            try {
                await session.run(`
                    MATCH (movies:${movieType.name})
                    MATCH (actors:${actorType.name})
                    DETACH DELETE movies, actors
                `);
            } finally {
                await session.close();
            }
        });

        describe("Update mutation", () => {
            test("Creates duplicate connections when connectAsDuplicate set to true", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: true
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.update}(
                            where: { title: $movieTitle }
                            connect: {
                                actors: [
                                    {
                                        where: { node: { name: $actorName1 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    }
                                ]
                            }
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.update]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(4);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicate connections when connectAsDuplicate set to false", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: false
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.update}(
                            where: { title: $movieTitle }
                            connect: {
                                actors: [
                                    {
                                        where: { node: { name: $actorName1 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    }
                                ]
                            }
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.update]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicates when connectAsDuplicate undefined", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime2: Int!) {
                        ${movieType.operations.update}(
                            where: { title: $movieTitle }
                            connect: {
                                actors: {
                                        where: { node: { name: $actorName1 } }
                                        edge: { screenTime: $screenTime2 }
                                }
                            }
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.update]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: [
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate false when asDuplicate true on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: false
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.update}(
                            where: { title: $movieTitle }
                            connect: {
                                actors: [
                                    {
                                        where: { node: { name: $actorName1 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        asDuplicate: true
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    }
                                ]
                            }
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.update]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate true when asDuplicate false on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: true
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.update}(
                            where: { title: $movieTitle }
                            connect: {
                                actors: [
                                    {
                                        where: { node: { name: $actorName1 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        asDuplicate: false
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        asDuplicate: false
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        asDuplicate: false
                                        where: { node: { name: $actorName2 } }
                                        edge: { screenTime: $screenTime2 }
                                    }
                                ]
                            }
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.update]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });
        });

        describe("Create mutation", () => {
            test("Creates duplicate connections when connectAsDuplicate set to true", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: true
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.create}(
                            input: [
                                { 
                                    title: $movieTitle
                                    actors: {
                                        connect: [
                                            {
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime1 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            }
                                        ]
                                    }
                                }
                            ]
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.create]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicate connections when connectAsDuplicate set to false", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: false
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.create}(
                            input: [
                                { 
                                    title: $movieTitle
                                    actors: {
                                        connect: [
                                            {
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime1 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            }
                                        ]
                                    }
                                }
                            ]
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.create]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicates when connectAsDuplicate undefined", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.create}(
                            input: [
                                { 
                                    title: $movieTitle
                                    actors: {
                                        connect: [
                                            {
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime1 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            }
                                        ]
                                    }
                                }
                            ]
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.create]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: [
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate false when asDuplicate true on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: false
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!, $actorName2: String!) {
                        ${movieType.operations.create}(
                            input: [
                                { 
                                    title: $movieTitle
                                    actors: {
                                        connect: [
                                            {
                                                asDuplicate: true
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime1 }
                                            },
                                            {
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime1 }
                                            },
                                            {
                                                asDuplicate: true
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            },
                                            {
                                                asDuplicate: true
                                                where: { node: { name: $actorName2 } }
                                                edge: { screenTime: $screenTime2 }
                                            }
                                        ]
                                    }
                                }
                            ]
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.create]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: actorName2,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(4);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate true when asDuplicate false on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN,
                            connectAsDuplicate: true
                        )
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${movieType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}", direction: OUT
                        )
                    }

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${movieType.operations.create}(
                            input: [
                                { 
                                    title: $movieTitle
                                    actors: {
                                        connect: [
                                            {
                                                asDuplicate: true
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime2 }
                                            },
                                            {
                                                asDuplicate: false
                                                where: { node: { name: $actorName1 } }
                                                edge: { screenTime: $screenTime1 }
                                            }
                                        ]
                                    }
                                }
                            ]
                        ) {
                            ${movieType.plural} {
                                title
                                actorsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH (:${movieType.name})<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [movieType.operations.create]: {
                            [movieType.plural]: [
                                {
                                    title: movieTitle,
                                    actorsConnection: {
                                        edges: [
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: actorName1,
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });
        });
    });

    describe("Unions", () => {
        let movieType: UniqueType;
        let actorType: UniqueType;
        let actedInInterface: UniqueType;
        let showType: UniqueType;
        let actedInUnion: UniqueType;

        beforeEach(() => {
            movieType = generateUniqueType("Movie");
            actorType = generateUniqueType("Actor");
            showType = generateUniqueType("Show");
            actedInUnion = generateUniqueType("ActedInUnion");
            actedInInterface = generateUniqueType("ActedIn");
        });

        afterEach(async () => {
            const session = await neo4j.getSession();

            try {
                await session.run(`
                    MATCH (movies:${movieType.name})
                    MATCH (actors:${actorType.name})
                    MATCH (shows:${showType.name})
                    DETACH DELETE movies, actors, shows
                `);
            } finally {
                await session.close();
            }
        });

        describe("Update mutation", () => {
            test("Creates duplicate connections when connectAsDuplicate set to true", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: true
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName1 }
                            connect: {
                                productions: {        
                                    ${movieType.name}: [
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                    ]
                                }
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicate connections when connectAsDuplicate set to false", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: false
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName1 }
                            connect: {
                                productions: {        
                                    ${movieType.name}: [
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                    ]
                                }
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: [
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicates when connectAsDuplicate undefined", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName1 }
                            connect: {
                                productions: {        
                                    ${movieType.name}: [
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                    ]
                                    ${showType.name}: [
                                        {
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                        {
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                    ]
                                }
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                            ... on ${showType.name} {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, showName, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate false when asDuplicate true on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: false
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName1 }
                            connect: {
                                productions: {        
                                    ${movieType.name}: [
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                        {
                                            asDuplicate: true
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                    ]
                                    ${showType.name}: [
                                        {
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                        {
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                    ]
                                }
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                            ... on ${showType.name} {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, showName, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate true when asDuplicate false on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: true
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName1 }
                            connect: {
                                productions: {        
                                    ${movieType.name}: [
                                        {
                                            asDuplicate: false
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                        {
                                            where: { node: { title: $movieTitle } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                    ]
                                    ${showType.name}: [
                                        {
                                            asDuplicate: false
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime2 }
                                        },
                                        {
                                            asDuplicate: false
                                            where: { node: { name: $showName } }
                                            edge: { screenTime: $screenTime1 }
                                        },
                                    ]
                                }
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                            ... on ${showType.name} {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })<-[:ACTED_IN { screenTime: $screenTime1 } ]-(:${actorType.name} { name: $actorName1 })
                            CREATE (:${actorType.name} { name: $actorName2 })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, screenTime1, actorName1, actorName2, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, showName, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });
        });

        describe("Create mutation", () => {
            test("Creates duplicate connections when connectAsDuplicate set to true", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: true
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.create}(
                            input: [
                                {
                                    name: $actorName1
                                    productions: {
                                        ${movieType.name}: {        
                                            connect: [
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                    }
                                }
                            ]

                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.create]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicate connections when connectAsDuplicate set to false", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: false
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.create}(
                            input: [
                                {
                                    name: $actorName1
                                    productions: {
                                        ${movieType.name}: {        
                                            connect: [
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                    }
                                }
                            ]

                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.create]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicates when connectAsDuplicate undefined", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.create}(
                            input: [
                                {
                                    name: $actorName1
                                    productions: {
                                        ${movieType.name}: {        
                                            connect: [
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                    }
                                }
                            ]

                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.create]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate false when asDuplicate true on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: false
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.create}(
                            input: [
                                {
                                    name: $actorName1
                                    productions: {
                                        ${movieType.name}: {        
                                            connect: [
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    asDuplicate: true
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                        ${showType.name}: {
                                            connect: [
                                                {
                                                    where: { node: { name: $showName } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    where: { node: { name: $showName } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                    }
                                }
                            ]

                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                            ... on ${showType.name} {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, showName, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.create]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate true when asDuplicate false on ConnectFieldInput", async () => {
                const typeDefs = `
                    type ${movieType.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: IN
                        )
                    }

                    type ${showType.name} {
                        name: String!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${actedInUnion.name}!]! @relationship(
                            type: "ACTED_IN", properties: "${actedInInterface.name}",
                            direction: OUT,
                            connectAsDuplicate: true
                        )
                    }

                    union ${actedInUnion.name} = ${movieType.name} | ${showType.name}

                    interface ${actedInInterface.name} {
                        screenTime: Int!
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName1: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.create}(
                            input: [
                                {
                                    name: $actorName1
                                    productions: {
                                        ${movieType.name}: {        
                                            connect: [
                                                {
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    asDuplicate: false
                                                    where: { node: { title: $movieTitle } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                        ${showType.name}: {
                                            connect: [
                                                {
                                                    asDuplicate: true
                                                    where: { node: { name: $showName } }
                                                    edge: { screenTime: $screenTime1 }
                                                },
                                                {
                                                    where: { node: { name: $showName } }
                                                    edge: { screenTime: $screenTime2 }
                                                },
                                            ]
                                        }
                                    }
                                }
                            ]

                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            ... on ${movieType.name} {
                                                title
                                            }
                                            ... on ${showType.name} {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle })
                            CREATE (:${showType.name} { name: $showName })
                        `,
                        { movieTitle, showName }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName1, showName, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.create]: {
                            [actorType.plural]: [
                                {
                                    name: actorName1,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    name: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });
        });
    });

    describe("Interfaces", () => {
        let movieType: UniqueType;
        let actorType: UniqueType;
        let actedInInterface: UniqueType;
        let productionInterface: UniqueType;
        let showType: UniqueType;

        beforeEach(() => {
            movieType = generateUniqueType("Movie");
            actorType = generateUniqueType("Actor");
            showType = generateUniqueType("Show");
            actedInInterface = generateUniqueType("ActedIn");
            productionInterface = generateUniqueType("Production");
        });

        afterEach(async () => {
            const session = await neo4j.getSession();

            try {
                await session.run(`
                    MATCH (movies:${movieType.name})
                    MATCH (actors:${actorType.name})
                    MATCH (shows:${showType.name})
                    DETACH DELETE movies, actors, shows
                `);
            } finally {
                await session.close();
            }
        });

        describe("Update mutation", () => {
            test("Creates duplicate connections when connectAsDuplicate set to true", async () => {
                const typeDefs = `
                    interface ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${movieType.name} implements ${productionInterface.name} {
                        title: String!
                        runTime: Int!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${showType.name} implements ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    interface ${actedInInterface.name} @relationshipProperties {
                        screenTime: Int!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${productionInterface.name}!]! @relationship(
                            type: "ACTED_IN",
                            direction: OUT,
                            properties: "${actedInInterface.name}",
                            connectAsDuplicate: true
                        )
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName2: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName2 }
                            connect: {
                                productions: [
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                ]
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            title
                                            ... on ${movieType.name} {
                                                runTime
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle, runTime: $runTime })
                            CREATE (:${showType.name} { title: $showName })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, runTime, showName, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName2,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicate connections when connectAsDuplicate set to false", async () => {
                const typeDefs = `
                    interface ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${movieType.name} implements ${productionInterface.name} {
                        title: String!
                        runTime: Int!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${showType.name} implements ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    interface ${actedInInterface.name} @relationshipProperties {
                        screenTime: Int!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${productionInterface.name}!]! @relationship(
                            type: "ACTED_IN",
                            direction: OUT,
                            properties: "${actedInInterface.name}",
                            connectAsDuplicate: false
                        )
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $actorName2: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName2 }
                            connect: {
                                productions: [
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                ]
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            title
                                            ... on ${movieType.name} {
                                                runTime
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle, runTime: $runTime })
                            CREATE (:${showType.name} { title: $showName })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, runTime, showName, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName2,
                                    productionsConnection: {
                                        edges: [
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(1);
                } finally {
                    await session.close();
                }
            });

            test("Does not create duplicates when connectAsDuplicate undefined", async () => {
                const typeDefs = `
                    interface ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${movieType.name} implements ${productionInterface.name} {
                        title: String!
                        runTime: Int!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${showType.name} implements ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    interface ${actedInInterface.name} @relationshipProperties {
                        screenTime: Int!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${productionInterface.name}!]! @relationship(
                            type: "ACTED_IN",
                            direction: OUT,
                            properties: "${actedInInterface.name}"
                        )
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName2: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName2 }
                            connect: {
                                productions: [
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { title: $showName } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                ]
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            title
                                            ... on ${movieType.name} {
                                                runTime
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle, runTime: $runTime })
                            CREATE (:${showType.name} { title: $showName })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, runTime, showName, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, showName, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName2,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(2);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate false when asDuplicate true on ConnectFieldInput", async () => {
                const typeDefs = `
                    interface ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${movieType.name} implements ${productionInterface.name} {
                        title: String!
                        runTime: Int!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${showType.name} implements ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    interface ${actedInInterface.name} @relationshipProperties {
                        screenTime: Int!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${productionInterface.name}!]! @relationship(
                            type: "ACTED_IN",
                            direction: OUT,
                            properties: "${actedInInterface.name}",
                            connectAsDuplicate: false
                        )
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName2: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName2 }
                            connect: {
                                productions: [
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { title: $showName } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        asDuplicate: true
                                        where: { node: { _on: { ${showType.name}: { title: $showName } } } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                ]
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            title
                                            ... on ${movieType.name} {
                                                runTime
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle, runTime: $runTime })
                            CREATE (:${showType.name} { title: $showName })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, runTime, showName, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, showName, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName2,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: showName,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });

            test("Overrides connectAsDuplicate true when asDuplicate false on ConnectFieldInput", async () => {
                const typeDefs = `
                    interface ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${movieType.name} implements ${productionInterface.name} {
                        title: String!
                        runTime: Int!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    type ${showType.name} implements ${productionInterface.name} {
                        title: String!
                        actors: [${actorType.name}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "${actedInInterface.name}")
                    }

                    interface ${actedInInterface.name} @relationshipProperties {
                        screenTime: Int!
                    }

                    type ${actorType.name} {
                        name: String!
                        productions: [${productionInterface.name}!]! @relationship(
                            type: "ACTED_IN",
                            direction: OUT,
                            properties: "${actedInInterface.name}",
                            connectAsDuplicate: true
                        )
                    }
                `;

                const source = `
                    mutation($movieTitle: String!, $showName: String!, $actorName2: String!, $screenTime1: Int!, $screenTime2: Int!) {
                        ${actorType.operations.update}(
                            where: { name: $actorName2 }
                            connect: {
                                productions: [
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        where: { node: { title: $movieTitle } }
                                        edge: { screenTime: $screenTime2 }
                                    },
                                    {
                                        where: { node: { title: $showName } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                    {
                                        asDuplicate: false
                                        where: { node: { _on: { ${showType.name}: { title: $showName } } } }
                                        edge: { screenTime: $screenTime1 }
                                    },
                                ]
                            }
                        ) {
                            ${actorType.plural} {
                                name
                                productionsConnection {
                                    edges {
                                        screenTime
                                        node {
                                            title
                                            ... on ${movieType.name} {
                                                runTime
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                `;

                const neoSchema = new Neo4jGraphQL({
                    typeDefs,
                });

                const session = await neo4j.getSession();

                try {
                    await session.run(
                        `
                            CREATE (:${movieType.name} { title: $movieTitle, runTime: $runTime })
                            CREATE (:${showType.name} { title: $showName })
                            CREATE (:${actorType.name} { name: $actorName2 })
                        `,
                        { movieTitle, runTime, showName, actorName2 }
                    );

                    const gqlResult = await graphql({
                        schema: await neoSchema.getSchema(),
                        source,
                        contextValue: neo4j.getContextValuesWithBookmarks(session.lastBookmark()),
                        variableValues: { movieTitle, showName, actorName2, screenTime1, screenTime2 },
                    });

                    const cypher = `
                        MATCH ()<-[r:ACTED_IN]-(:${actorType.name})
                        RETURN r
                    `;
                    const neo4jResult = await session.run(cypher, {
                        movieTitle,
                        screenTime: screenTime1,
                        actorName: actorName1,
                    });

                    expect(gqlResult.errors).toBeFalsy();
                    expect(gqlResult.data).toEqual({
                        [actorType.operations.update]: {
                            [actorType.plural]: [
                                {
                                    name: actorName2,
                                    productionsConnection: {
                                        edges: expect.toIncludeSameMembers([
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                            {
                                                screenTime: screenTime2,
                                                node: {
                                                    title: movieTitle,
                                                    runTime,
                                                },
                                            },
                                            {
                                                screenTime: screenTime1,
                                                node: {
                                                    title: showName,
                                                },
                                            },
                                        ]),
                                    },
                                },
                            ],
                        },
                    });

                    expect(neo4jResult.records).toHaveLength(3);
                } finally {
                    await session.close();
                }
            });
        });
    });
});
