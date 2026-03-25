import { Router } from 'express';
import { getMcpServers, getMcpTools, callMcpTool, syncMcpTools, testMcpTools, createMcpServer, updateMcpServer, deleteMcpServer } from '../controllers/mcp.controller';
import { authenticate } from '../middlewares/auth.middleware';


const router = Router();

// All MCP routes require authentication
router.use(authenticate);

// Endpoint: /backend/api/mcp/servers
router.get('/servers', getMcpServers);

// Endpoint: /backend/api/mcp/tools
router.get('/tools', getMcpTools);

// Endpoint: /backend/api/mcp/call
router.post('/call', callMcpTool);

// Endpoint: /backend/api/mcp/sync
router.post('/sync', syncMcpTools);

// New endpoints for adding MCP servers
router.post('/test-tools', testMcpTools);
router.post('/server', createMcpServer);
router.put('/server', updateMcpServer);
router.delete('/server/:id', deleteMcpServer);

export default router;

