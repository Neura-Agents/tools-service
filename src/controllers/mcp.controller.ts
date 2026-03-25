import { Response } from 'express';
import axios from 'axios';
import { ENV } from '../config/env.config';
import logger from '../config/logger';
import { pool } from '../config/db.config';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export const getMcpServers = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: User ID missing from token' });
        }
        const { query, page = 1, limit = 9 } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        let whereClause = 'WHERE (user_id = $1 OR visibility = \'public\')';
        const params: any[] = [userId];
        
        if (query) {
            params.push(`%${query}%`);
            whereClause += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
        }

        // Get total count
        const countRes = await pool.query(`SELECT COUNT(*) FROM mcp_servers ${whereClause}`, params);
        const total = parseInt(countRes.rows[0].count);

        // Get paginated servers
        const serverParams = [...params, limitNum, offset];
        const { rows } = await pool.query(
            `SELECT *, name as server_name 
             FROM mcp_servers ${whereClause} 
             ORDER BY name ASC 
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            serverParams
        );

        res.json({ mcp_servers: rows, total });
    } catch (err: any) {
        logger.error({ err: err.message }, 'Error fetching MCP servers from DB');
        res.status(500).json({ error: 'Failed to fetch MCP servers from database' });
    }
};

export const syncMcpTools = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id || 'system';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Sync Servers
        const serversUrl = `${ENV.AI_GATEWAY_URL}/v1/mcp/server`;
        logger.info(`Syncing MCP servers from ${serversUrl}`);
        
        const serversResponse = await axios.get(serversUrl, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const servers = serversResponse.data?.mcp_servers || serversResponse.data || [];
        for (const server of servers) {
            const sId = server.server_id;
            await client.query(
                `INSERT INTO mcp_servers (server_id, name, description, status, transport, url, user_id, visibility)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (server_id) 
                 DO UPDATE SET 
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    transport = EXCLUDED.transport,
                    url = EXCLUDED.url,
                    updated_at = CURRENT_TIMESTAMP`,
                [sId, server.server_name || server.name, server.description, server.status, server.transport, server.url, userId, 'public']
            );

            // Fetch tools for this specific server
            await syncToolsForServer(sId, client);
        }

        await client.query('COMMIT');
        res.json({ success: true, serverCount: servers.length });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error({ err: err.message }, 'Error syncing MCP data');
        res.status(500).json({ error: 'Failed to sync MCP data from AI Gateway' });
    } finally {
        client.release();
    }
};

export const getMcpTools = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { server_id } = req.query;
        
        // Fix: Use a join to ensure tools are only returned for servers the user has access to
        let queryStr = `
            SELECT t.*, t.input_schema as "inputSchema" 
            FROM mcp_tools t
            JOIN mcp_servers s ON t.server_id = s.server_id
            WHERE (s.user_id = $1 OR s.visibility = 'public')
        `;
        const params: any[] = [userId];

        if (server_id) {
            queryStr += ' AND t.server_id = $2';
            params.push(server_id);
        }

        queryStr += ' ORDER BY t.name ASC';
        
        const { rows } = await pool.query(queryStr, params);
        res.json({ tools: rows });
    } catch (err: any) {
        logger.error({ err: err.message }, 'Error fetching MCP tools from DB');
        res.status(500).json({ error: 'Failed to fetch MCP tools' });
    }
};

export const callMcpTool = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, arguments: args, server_id, serverName } = req.body;
        const url = `${ENV.AI_GATEWAY_URL}/mcp-rest/tools/call`;

        logger.info({ tool: name, server: server_id || serverName }, `Calling MCP tool via ${url}`);
        
        const response = await axios.post(url, {
            name,
            arguments: args,
            server_id: server_id || serverName
        }, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (err: any) {
        logger.error({ 
            err: err.response?.data || err.message,
            status: err.response?.status
        }, 'Error calling MCP tool via AI Gateway');
        
        res.status(err.response?.status || 500).json({
            error: true,
            message: 'Failed to call MCP tool',
            details: err.response?.data || err.message
        });
    }
};

export const testMcpTools = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { server_id, server_name, url, transport, auth_type } = req.body;
        const testUrl = `${ENV.AI_GATEWAY_URL}/mcp-rest/test/tools/list`;

        logger.info({ url: testUrl }, 'Testing MCP tools list');

        const response = await axios.post(testUrl, {
            server_id: server_id || "",
            server_name: server_name || "",
            url,
            transport: transport.toLowerCase(),
            auth_type: auth_type || "none"
        }, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (err: any) {
        logger.error({
            err: err.response?.data || err.message,
            status: err.response?.status
        }, 'Error testing MCP tools');

        res.status(err.response?.status || 500).json({
            error: true,
            message: 'Failed to fetch tools for testing',
            details: err.response?.data || err.message
        });
    }
};

export const createMcpServer = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id || 'system';
        const { transport, url, auth_type, mcp_info, allowed_tools, visibility = 'public', alias } = req.body;
        const createUrl = `${ENV.AI_GATEWAY_URL}/v1/mcp/server`;

        logger.info({ url: createUrl, userId, visibility }, 'Creating MCP server in AI Gateway and local DB');

        // Call AI Gateway (without visibility)
        const response = await axios.post(createUrl, {
            transport: transport.toLowerCase(),
            url,
            auth_type: auth_type || "none",
            mcp_info: {
                server_name: mcp_info?.server_name || url,
                mcp_server_cost_info: mcp_info?.mcp_server_cost_info || null
            },
            allowed_tools: allowed_tools || []
        }, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const gatewayData = response.data;
        const serverId = gatewayData?.server_id || gatewayData?.id || url;

        // Save to local database
        await pool.query(
            `INSERT INTO mcp_servers (server_id, name, alias, description, status, transport, url, auth_type, user_id, visibility)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (server_id) 
             DO UPDATE SET 
                name = EXCLUDED.name,
                alias = EXCLUDED.alias,
                description = EXCLUDED.description,
                status = EXCLUDED.status,
                transport = EXCLUDED.transport,
                url = EXCLUDED.url,
                auth_type = EXCLUDED.auth_type,
                user_id = EXCLUDED.user_id,
                visibility = EXCLUDED.visibility,
                updated_at = CURRENT_TIMESTAMP`,
            [
                serverId, 
                mcp_info?.server_name || url,
                alias || '',
                mcp_info?.description || '', 
                'active', 
                transport.toLowerCase(), 
                url, 
                auth_type || 'none',
                userId, 
                visibility
            ]
        );

        // Sync tools immediately to local DB
        try {
            await syncToolsForServer(serverId, pool);
        } catch (syncErr: any) {
            logger.warn(`Initial tool sync failed for server ${serverId}: ${syncErr.message}`);
        }

        res.json(gatewayData);
    } catch (err: any) {
        logger.error({
            err: err.response?.data || err.message,
            status: err.response?.status
        }, 'Error creating MCP server');

        res.status(err.response?.status || 500).json({
            error: true,
            message: 'Failed to create MCP server',
            details: err.response?.data || err.message
        });
    }
};

export const updateMcpServer = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id || 'system';
        const { visibility, ...rest } = req.body;
        const updateUrl = `${ENV.AI_GATEWAY_URL}/v1/mcp/server`;

        logger.info({ url: updateUrl, userId }, 'Updating MCP server in AI Gateway and local DB');

        // Call AI Gateway
        const response = await axios.put(updateUrl, rest, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Update local database
        const serverId = rest.server_id;
        const mcpInfo = rest.mcp_info;

        const updateResult = await pool.query(
            `UPDATE mcp_servers 
             SET name = $1, 
                 alias = $2,
                 description = $3, 
                 visibility = $4,
                 auth_type = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE server_id = $6 AND user_id = $7`,
            [
                mcpInfo?.server_name || rest.server_name, 
                rest.alias || '',
                mcpInfo?.description || rest.description, 
                visibility || 'public', 
                rest.auth_type || 'none',
                serverId, 
                userId
            ]
        );

        if (updateResult.rowCount === 0) {
            return res.status(403).json({ error: 'Forbidden: You do not have permission to update this server' });
        }

        // Sync tools immediately to local DB
        try {
            await syncToolsForServer(serverId, pool);
        } catch (syncErr: any) {
            logger.warn(`Post-update tool sync failed for server ${serverId}: ${syncErr.message}`);
        }

        res.json(response.data);
    } catch (err: any) {
        logger.error({
            err: err.response?.data || err.message,
            status: err.response?.status
        }, 'Error updating MCP server');

        res.status(err.response?.status || 500).json({
            error: true,
            message: 'Failed to update MCP server',
            details: err.response?.data || err.message
        });
    }
};

export const deleteMcpServer = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id || 'system';
        const { id } = req.params;
        const deleteUrl = `${ENV.AI_GATEWAY_URL}/v1/mcp/server/${id}`;

        logger.info({ url: deleteUrl, userId }, 'Deleting MCP server in AI Gateway and local DB');

        // Call AI Gateway
        try {
            await axios.delete(deleteUrl, {
                headers: {
                    'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`
                }
            });
        } catch (gatewayErr: any) {
            // Log but continue if gateway delete fails (might already be deleted there)
            logger.warn({ err: gatewayErr.message }, 'AI Gateway delete failed, continuing with local delete');
        }

        // Delete from local database - tools table CASCADE if foreign keys are set up correctly
        // But for safety, I'll delete tools first if needed, though CASCADE is usually cleaner.
        // Looking at the migration, tools are references by server_id.
        // Delete from local database
        await pool.query('DELETE FROM mcp_tools WHERE server_id = $1', [id]);
        const result = await pool.query(
            `DELETE FROM mcp_servers WHERE server_id = $1 AND user_id = $2`,
            [id, userId]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ error: 'Forbidden: You do not have permission to delete this server or it does not exist' });
        }

        res.json({ success: true, message: 'MCP server deleted successfully' });
    } catch (err: any) {
        logger.error({
            err: err.response?.data || err.message,
            status: err.response?.status
        }, 'Error deleting MCP server');

        res.status(err.response?.status || 500).json({
            error: true,
            message: 'Failed to delete MCP server',
            details: err.response?.data || err.message
        });
    }
};

/**
 * Syncs tools for a single server from AI Gateway to local DB.
 */
async function syncToolsForServer(serverId: string, dbClientOrPool: any) {
    logger.info(`Fetching tools for server from AI Gateway: ${serverId}`);
    try {
        const toolsUrl = `${ENV.AI_GATEWAY_URL}/mcp-rest/tools/list?server_id=${serverId}`;
        const toolsResponse = await axios.get(toolsUrl, {
            headers: {
                'Authorization': `Bearer ${ENV.AI_GATEWAY_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const tools = toolsResponse.data?.tools || [];
        for (const tool of tools) {
            const schema = tool.input_schema || tool.inputSchema || {};
            const desc = tool.description || '';
            
            await dbClientOrPool.query(
                `INSERT INTO mcp_tools (server_id, name, description, input_schema)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (server_id, name) 
                 DO UPDATE SET 
                    description = EXCLUDED.description,
                    input_schema = EXCLUDED.input_schema,
                    updated_at = CURRENT_TIMESTAMP`,
                [serverId, tool.name, desc, JSON.stringify(schema)]
            );
        }
        logger.info(`Successfully synced ${tools.length} tools for server ${serverId}`);
    } catch (toolSyncError: any) {
        logger.warn(`Failed to sync tools for server ${serverId}: ${toolSyncError.message}`);
        throw toolSyncError;
    }
}
