import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const ENV = {
    PORT: process.env.PORT || 3001,
    NODE_ENV: process.env.NODE_ENV || 'development',
    DB: {
        HOST: process.env.DB_HOST || 'localhost',
        PORT: parseInt(process.env.DB_PORT || '5432', 10),
        USER: process.env.DB_USER || 'postgres',
        PASSWORD: process.env.DB_PASSWORD || 'postgres',
        NAME: process.env.DB_NAME || 'neura-agents-platform',
    },
    LOG: {
        LEVEL: process.env.LOG_LEVEL || 'info',
    },
    AI_GATEWAY_URL: process.env.AI_GATEWAY_URL || 'http://localhost:4000',
    AI_GATEWAY_KEY: process.env.LITELLM_API_KEY || process.env.AI_GATEWAY_KEY || '',
    PLATFORM_SERVICE_URL: process.env.PLATFORM_SERVICE_URL || 'http://localhost:3006',
    NEO4J: {
        URL: process.env.NEO4J_URL || 'bolt://localhost:7687',
        USER: process.env.NEO4J_USER || 'neo4j',
        PASSWORD: process.env.NEO4J_PASSWORD || 'neo4jpassword',
    },
    KEYCLOAK: {
        ISSUER_URL: process.env.KEYCLOAK_ISSUER_URL || 'http://keycloak:8080/realms/neura-agents',
        PUBLIC_ISSUER_URL: process.env.KEYCLOAK_PUBLIC_ISSUER_URL || 'http://localhost:8081/realms/neura-agents',
        REALM: process.env.VITE_KEYCLOAK_REALM || 'neura-agents'
    }
};
