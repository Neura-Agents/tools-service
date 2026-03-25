import express from 'express';
import cors from 'cors';
import { ENV } from './config/env.config';
import { initDb } from './config/db.config';
import { initNeo4j } from './config/neo4j.config';
import logger from './config/logger';

import toolRoutes from './routes/tools.routes';
import mcpRoutes from './routes/mcp.routes';
import knowledgeRoutes from './routes/knowledge.routes';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Log requests
app.use((req, res, next) => {
    logger.info({ 
        method: req.method, 
        url: req.url,
        ip: req.ip 
    }, 'Incoming Request');
    next();
});

// Routes
app.use('/backend/api/tools', toolRoutes);
app.use('/backend/api/mcp', mcpRoutes);
app.use('/backend/api/knowledge', knowledgeRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'tools-service' });
});

// Error Handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ err, url: req.url }, 'Unhandled error occurred');
    res.status(500).json({ error: 'Internal Server Error' });
});

const start = async () => {
    try {
        await initDb();
        await initNeo4j();
        app.listen(ENV.PORT, () => {
            logger.info(`Tools service listening on port ${ENV.PORT} in ${ENV.NODE_ENV} mode`);
        });
    } catch (err) {
        logger.fatal({ err }, 'Failed to start tools service');
        process.exit(1);
    }
};

start();
