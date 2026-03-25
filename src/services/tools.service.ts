import { pool } from '../config/db.config';
import { Tool, ToolParameter } from '../types/tool.types';
import logger from '../config/logger';

export class ToolsService {
    async getTools(userId: string, search?: string, limit: number = 10, offset: number = 0): Promise<{ tools: Tool[], total: number }> {
        let whereClause = 'WHERE (t.user_id = $1 OR t.visibility = \'public\')';
        const params: any[] = [userId];

        if (search) {
            params.push(`%${search}%`);
            whereClause += ` AND (t.name ILIKE $${params.length} OR t.description ILIKE $${params.length} OR t.path ILIKE $${params.length})`;
        }

        const countQuery = `SELECT COUNT(*) FROM tools t ${whereClause}`;
        const { rows: countRows } = await pool.query(countQuery, params);
        const total = parseInt(countRows[0].count);

        const query = `
            SELECT t.*, 
                COALESCE(json_agg(json_build_object(
                    'id', p.id,
                    'tool_id', p.tool_id,
                    'name', p.name,
                    'in', p.location,
                    'required', p.required,
                    'type', p.type,
                    'description', p.description,
                    'item_type', p.item_type,
                    'parent_id', p.parent_id
                )) FILTER (WHERE p.id IS NOT NULL), '[]') as parameters
            FROM tools t
            LEFT JOIN tool_parameters p ON t.id = p.tool_id
            ${whereClause}
            GROUP BY t.id
            ORDER BY t.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        const { rows } = await pool.query(query, [...params, limit, offset]);
        const tools = rows.map(r => ({
            ...r,
            baseUrl: r.base_url,
            authType: r.auth_type,
            authDetails: r.auth_details,
            parameters: this.buildParameterTree(r.parameters.map((p: any) => ({
                ...p,
                required: !!p.required
            })))
        }));

        return { tools, total };
    }

    async getToolById(id: string, userId: string): Promise<Tool | null> {
        const query = `
            SELECT t.*, 
                COALESCE(json_agg(json_build_object(
                    'id', p.id,
                    'tool_id', p.tool_id,
                    'name', p.name,
                    'in', p.location,
                    'required', p.required,
                    'type', p.type,
                    'description', p.description,
                    'item_type', p.item_type,
                    'parent_id', p.parent_id
                )) FILTER (WHERE p.id IS NOT NULL), '[]') as parameters
            FROM tools t
            LEFT JOIN tool_parameters p ON t.id = p.tool_id
            WHERE t.id = $1 AND (t.user_id = $2 OR t.visibility = 'public')
            GROUP BY t.id
        `;
        const { rows } = await pool.query(query, [id, userId]);
        if (rows.length === 0) return null;
        return {
            ...rows[0],
            baseUrl: rows[0].base_url,
            authType: rows[0].auth_type,
            authDetails: rows[0].auth_details,
            parameters: this.buildParameterTree(rows[0].parameters.map((p: any) => ({
                ...p,
                required: !!p.required
            })))
        };
    }

    async getToolByName(name: string, userId: string): Promise<Tool | null> {
        const query = `
            SELECT t.*, 
                COALESCE(json_agg(json_build_object(
                    'id', p.id,
                    'tool_id', p.tool_id,
                    'name', p.name,
                    'in', p.location,
                    'required', p.required,
                    'type', p.type,
                    'description', p.description,
                    'item_type', p.item_type,
                    'parent_id', p.parent_id
                )) FILTER (WHERE p.id IS NOT NULL), '[]') as parameters
            FROM tools t
            LEFT JOIN tool_parameters p ON t.id = p.tool_id
            WHERE t.name = $1 AND (t.user_id = $2 OR t.visibility = 'public')
            GROUP BY t.id
        `;
        const { rows } = await pool.query(query, [name, userId]);
        if (rows.length === 0) return null;
        return {
            ...rows[0],
            baseUrl: rows[0].base_url,
            authType: rows[0].auth_type,
            authDetails: rows[0].auth_details,
            parameters: this.buildParameterTree(rows[0].parameters.map((p: any) => ({
                ...p,
                required: !!p.required
            })))
        };
    }

    async createTool(tool: Partial<Tool>, userId: string): Promise<Tool> {
        const results = await this.createTools([tool], userId);
        return results[0];
    }

    async createTools(tools: Partial<Tool>[], userId: string): Promise<Tool[]> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const createdTools: Tool[] = [];

            for (const tool of tools) {
                const toolQuery = `
                    INSERT INTO tools (name, description, method, base_url, path, auth_type, auth_details, user_id, visibility, icon)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING *
                `;
                const { rows: toolRows } = await client.query(toolQuery, [
                    tool.name,
                    tool.description,
                    tool.method,
                    tool.baseUrl,
                    tool.path,
                    tool.authType,
                    JSON.stringify(tool.authDetails || {}),
                    userId,
                    tool.visibility || 'private',
                    tool.icon
                ]);

                const newTool = toolRows[0];
                const parameters: ToolParameter[] = [];

                if (tool.parameters && tool.parameters.length > 0) {
                    await this.saveParameters(client, newTool.id, tool.parameters);
                    const { rows: savedParams } = await client.query(`
                        SELECT id, name, location as in, required, type, description, item_type, parent_id
                        FROM tool_parameters WHERE tool_id = $1
                    `, [newTool.id]);
                    parameters.push(...this.buildParameterTree(savedParams.map(p => ({ ...p, required: !!p.required }))));
                }

                createdTools.push({ 
                    ...newTool, 
                    baseUrl: newTool.base_url,
                    authType: newTool.auth_type,
                    authDetails: newTool.auth_details,
                    parameters 
                });
            }

            await client.query('COMMIT');
            return createdTools;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error({ error }, 'Failed to create tools');
            throw error;
        } finally {
            client.release();
        }
    }

    async updateTool(id: string, tool: Partial<Tool>, userId: string): Promise<Tool | null> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const toolQuery = `
                UPDATE tools 
                SET name = $1, description = $2, method = $3, base_url = $4, path = $5, auth_type = $6, auth_details = $7, visibility = $8, icon = $9, updated_at = CURRENT_TIMESTAMP
                WHERE id = $10 AND user_id = $11
                RETURNING *
            `;
            const { rows: toolRows } = await client.query(toolQuery, [
                tool.name,
                tool.description,
                tool.method,
                tool.baseUrl,
                tool.path,
                tool.authType,
                JSON.stringify(tool.authDetails || {}),
                tool.visibility || 'private',
                tool.icon,
                id,
                userId
            ]);

            if (toolRows.length === 0) {
                await client.query('ROLLBACK');
                return null;
            }

            // Simple approach: Delete existing parameters and recreate
            await client.query('DELETE FROM tool_parameters WHERE tool_id = $1', [id]);

            const parameters: ToolParameter[] = [];
            if (tool.parameters && tool.parameters.length > 0) {
                await this.saveParameters(client, id, tool.parameters);
                const { rows: savedParams } = await client.query(`
                    SELECT id, name, location as in, required, type, description, item_type, parent_id
                    FROM tool_parameters WHERE tool_id = $1
                `, [id]);
                parameters.push(...this.buildParameterTree(savedParams.map(p => ({ ...p, required: !!p.required }))));
            }

            await client.query('COMMIT');
            return { 
                ...toolRows[0], 
                baseUrl: toolRows[0].base_url,
                authType: toolRows[0].auth_type,
                authDetails: toolRows[0].auth_details,
                parameters 
            };
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error({ error }, 'Failed to update tool');
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteTool(id: string, userId: string): Promise<boolean> {
        const { rowCount } = await pool.query('DELETE FROM tools WHERE id = $1 AND user_id = $2', [id, userId]);
        return (rowCount ?? 0) > 0;
    }

    async checkConflicts(tools: Partial<Tool>[], userId: string): Promise<{ existing: Tool, incoming: Partial<Tool> }[]> {
        const conflicts: { existing: Tool, incoming: Partial<Tool> }[] = [];
        
        for (const incoming of tools) {
            // Check for duplicate path + method OR name
            const query = `
                SELECT id, name, method, path 
                FROM tools 
                WHERE user_id = $1 AND (
                    (path = $2 AND method = $3) OR name = $4
                )
            `;
            const { rows } = await pool.query(query, [userId, incoming.path, incoming.method, incoming.name]);
            
            if (rows.length > 0) {
                conflicts.push({ existing: rows[0] as Tool, incoming });
            }
        }
        
        return conflicts;
    }

    async executeTool(name: string, params: any, userId: string): Promise<any> {
        const tool = await this.getToolByName(name, userId);
        if (!tool) throw new Error(`Tool "${name}" not found`);

        const baseUrl = tool.baseUrl || '';
        let url = `${baseUrl}${tool.path}`;
        const headers: any = { 'Content-Type': 'application/json' };
        let body: any = null;
        const queryParams = new URLSearchParams();

        if (tool.parameters) {
            for (const paramDef of tool.parameters) {
                const value = params[paramDef.name];
                if (paramDef.required && value === undefined) {
                    throw new Error(`Missing required parameter: ${paramDef.name}`);
                }
                if (value !== undefined) {
                    switch (paramDef.in) {
                        case 'path':
                            url = url.replace(`{${paramDef.name}}`, value).replace(`:${paramDef.name}`, value);
                            break;
                        case 'query':
                            queryParams.append(paramDef.name, value.toString());
                            break;
                        case 'header':
                            headers[paramDef.name] = value.toString();
                            break;
                        case 'body':
                            if (paramDef.name === 'body' && typeof value === 'object') {
                                body = value;
                            } else {
                                if (!body) body = {};
                                body[paramDef.name] = value;
                            }
                            break;
                    }
                }
            }
        }

        const queryString = queryParams.toString();
        if (queryString) {
            url += (url.includes('?') ? '&' : '?') + queryString;
        }

        const auth = tool.authDetails || ({} as any);
        switch (tool.authType) {
            case 'apiKey':
                if (auth.key && auth.value) {
                    headers[auth.key] = auth.value;
                }
                break;
            case 'bearer':
            case 'http':
                if (auth.token || auth.value) {
                    headers['Authorization'] = `Bearer ${auth.token || auth.value}`;
                }
                break;
            case 'basic':
                if (auth.username && auth.password) {
                    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${encoded}`;
                }
                break;
        }

        try {
            const response = await fetch(url, {
                method: tool.method,
                headers,
                body: (tool.method !== 'GET' && tool.method !== 'DELETE' && body) ? JSON.stringify(body) : undefined
            });

            const contentType = response.headers.get('content-type');
            let data;
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = { text: await response.text() };
            }

            if (!response.ok) {
                return { error: true, status: response.status, data };
            }

            return data;
        } catch (error: any) {
            logger.error({ error, url }, `Failed to execute tool: ${name}`);
            throw error;
        }
    }

    private async saveParameters(client: any, toolId: string, parameters: ToolParameter[], parentId: string | null = null): Promise<void> {
        for (const param of parameters) {
            const paramQuery = `
                INSERT INTO tool_parameters (tool_id, name, location, required, type, description, item_type, parent_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `;
            const { rows } = await client.query(paramQuery, [
                toolId,
                param.name,
                param.in,
                param.required,
                param.type,
                param.description,
                param.item_type || null,
                parentId
            ]);
            
            const newParamId = rows[0].id;
            if (param.children && param.children.length > 0) {
                await this.saveParameters(client, toolId, param.children, newParamId);
            }
        }
    }

    private buildParameterTree(params: any[]): ToolParameter[] {
        const map: Record<string, any> = {};
        params.forEach(p => {
            map[p.id] = { ...p, children: [] };
        });
        
        const root: ToolParameter[] = [];
        params.forEach(p => {
            if (p.parent_id && map[p.parent_id]) {
                map[p.parent_id].children.push(map[p.id]);
            } else {
                root.push(map[p.id]);
            }
        });
        
        return root;
    }
}
