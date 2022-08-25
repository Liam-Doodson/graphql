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
import type { Response } from "supertest";
import supertest from "supertest";
import { Neo4jGraphQL } from "../../../src/classes";
import { generateUniqueType } from "../../utils/graphql-types";
import type { TestGraphQLServer } from "../setup/apollo-server";
import { ApolloTestServer } from "../setup/apollo-server";
import { TestSubscriptionsPlugin } from "../../utils/TestSubscriptionPlugin";
import { WebSocketTestClient } from "../setup/ws-client";
import Neo4j from "../setup/neo4j";

describe("Delete Subscription", () => {
    let neo4j: Neo4j;
    let driver: Driver;

    const typeMovie = generateUniqueType("Movie");

    let server: TestGraphQLServer;
    let wsClient: WebSocketTestClient;

    beforeAll(async () => {
        const typeDefs = `
         type ${typeMovie} {
             title: String
         }
         `;

        neo4j = new Neo4j();
        driver = await neo4j.getDriver();

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            driver,
            config: {
                driverConfig: {
                    database: neo4j.getIntegrationDatabaseName(),
                },
            },
            plugins: {
                subscriptions: new TestSubscriptionsPlugin(),
            },
        });

        server = new ApolloTestServer(neoSchema);
        await server.start();
    });

    beforeEach(() => {
        wsClient = new WebSocketTestClient(server.wsPath);
    });

    afterEach(async () => {
        await wsClient.close();
    });

    afterAll(async () => {
        await server.close();
        await driver.close();
    });

    test("delete subscription", async () => {
        await wsClient.subscribe(`
            subscription {
                ${typeMovie.operations.subscribe.deleted} {
                    ${typeMovie.operations.subscribe.payload.deleted} {
                        title
                    }
                    event
                    timestamp
                }
            }
        `);

        await createMovie("movie1");
        await createMovie("movie2");

        await deleteMovie("movie1");
        await deleteMovie("movie2");

        expect(wsClient.errors).toEqual([]);
        expect(wsClient.events).toEqual([
            {
                [typeMovie.operations.subscribe.deleted]: {
                    [typeMovie.operations.subscribe.payload.deleted]: { title: "movie1" },
                    event: "DELETE",
                    timestamp: expect.any(Number),
                },
            },
            {
                [typeMovie.operations.subscribe.deleted]: {
                    [typeMovie.operations.subscribe.payload.deleted]: { title: "movie2" },
                    event: "DELETE",
                    timestamp: expect.any(Number),
                },
            },
        ]);
    });

    test("delete subscription with where", async () => {
        await wsClient.subscribe(`
            subscription {
                ${typeMovie.operations.subscribe.deleted}(where: { title: "movie3" }) {
                    ${typeMovie.operations.subscribe.payload.deleted} {
                        title
                    }
                }
            }
        `);

        await createMovie("movie3");
        await createMovie("movie4");

        await deleteMovie("movie3");
        await deleteMovie("movie4");

        expect(wsClient.errors).toEqual([]);
        expect(wsClient.events).toEqual([
            {
                [typeMovie.operations.subscribe.deleted]: {
                    [typeMovie.operations.subscribe.payload.deleted]: { title: "movie3" },
                },
            },
        ]);
    });

    // filters start below
    test("delete subscription with where _NOT 1 result", async () => {
        await wsClient.subscribe(`
            subscription {
                ${typeMovie.operations.subscribe.deleted}(where: { title_NOT: "movie3" }) {
                    ${typeMovie.operations.subscribe.payload.deleted} {
                        title
                    }
                }
            }
        `);

        await createMovie("movie3");
        await createMovie("movie4");

        await deleteMovie("movie3");
        await deleteMovie("movie4");

        expect(wsClient.errors).toEqual([]);
        expect(wsClient.events).toEqual([
            {
                [typeMovie.operations.subscribe.deleted]: {
                    [typeMovie.operations.subscribe.payload.deleted]: { title: "movie4" },
                },
            },
        ]);
    });
    test("delete subscription with where _NOT multiple results", async () => {
        await wsClient.subscribe(`
            subscription {
                ${typeMovie.operations.subscribe.deleted}(where: { title_NOT: "movie1" }) {
                    ${typeMovie.operations.subscribe.payload.deleted} {
                        title
                    }
                }
            }
        `);

        await createMovie("movie3");
        await createMovie("movie4");

        await deleteMovie("movie3");
        await deleteMovie("movie4");

        expect(wsClient.errors).toEqual([]);
        expect(wsClient.events).toContainEqual({
            [typeMovie.operations.subscribe.deleted]: {
                [typeMovie.operations.subscribe.payload.deleted]: { title: "movie3" },
            },
        });
        expect(wsClient.events).toContainEqual({
            [typeMovie.operations.subscribe.deleted]: {
                [typeMovie.operations.subscribe.payload.deleted]: { title: "movie4" },
            },
        });
    });
    test("delete subscription with where _NOT no result", async () => {
        await wsClient.subscribe(`
            subscription {
                ${typeMovie.operations.subscribe.deleted}(where: { title_NOT: "movie3" }) {
                    ${typeMovie.operations.subscribe.payload.deleted} {
                        title
                    }
                }
            }
        `);

        await createMovie("movie3");

        await deleteMovie("movie3");

        expect(wsClient.errors).toEqual([]);
        expect(wsClient.events).toEqual([]);
    });

    async function createMovie(title: string): Promise<Response> {
        const result = await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.create}(input: [{ title: "${title}" }]) {
                            ${typeMovie.plural} {
                                title
                            }
                        }
                    }
                `,
            })
            .expect(200);
        return result;
    }

    async function deleteMovie(title: string): Promise<Response> {
        const result = await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(where: { title: "${title}" }) {
                            nodesDeleted
                        }
                    }
                `,
            })
            .expect(200);
        return result;
    }
});
