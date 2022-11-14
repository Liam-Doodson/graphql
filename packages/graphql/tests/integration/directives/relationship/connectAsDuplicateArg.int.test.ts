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

describe("Relationship properties - connect", () => {
    let driver: Driver;
    let neo4j: Neo4j;

    const movieTitle = "A movie title";
    const showTitle = "some-show";
    const actorName1 = "An Actor";
    const actorName2 = "Name";
    const screenTime1 = 321;
    const screenTime2 = 2;
    const nonExistantMovie = "Does not exist";
    const nonExistantActor = "Not an actor";

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
                    movies: [${movieType.name}!]! @relationship(
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
                    movies: [${movieType.name}!]! @relationship(
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
    });
});
