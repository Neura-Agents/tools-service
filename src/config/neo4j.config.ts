import neo4j, { Driver } from 'neo4j-driver';
import { ENV } from './env.config';

let driver: Driver;

export const getNeo4jDriver = (): Driver => {
    if (!driver) {
        driver = neo4j.driver(
            ENV.NEO4J.URL,
            neo4j.auth.basic(ENV.NEO4J.USER, ENV.NEO4J.PASSWORD)
        );
    }
    return driver;
};

export const initNeo4j = async () => {
    const d = getNeo4jDriver();
    try {
        await d.verifyConnectivity();
        console.log('Neo4j connection established successfully');
    } catch (error) {
        console.error('Failed to connect to Neo4j:', error);
        // We don't throw here to allow the service to start even if Neo4j is down
    }
};
