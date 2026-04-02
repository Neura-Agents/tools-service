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
    INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || 'super-secret-key',
    LITELLM_URL: process.env.LITELLM_URL || 'http://ai-gateway:4000',
    LITELLM_MASTER_KEY: process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || '',
    PLATFORM_SERVICE_URL: process.env.PLATFORM_SERVICE_URL || 'http://platform-service:3006',
    BILLING_SERVICE_URL: process.env.BILLING_SERVICE_URL || 'http://billing-service:3007',
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
