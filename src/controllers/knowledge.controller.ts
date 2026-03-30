import { Response } from 'express';
import { pool } from '../config/db.config';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import axios from 'axios';
import FormData from 'form-data';
import logger from '../config/logger';
import { KnowledgeService } from '../services/knowledge.service';
import { GraphService } from '../services/graph.service';
import { getTemporalClient } from '../temporal/client';
import { WorkflowNotFoundError } from '@temporalio/client';
import { ENV } from '../config/env.config';

export class KnowledgeController {
    // Helper to format SSE events
    private static sendSSEEvent(res: Response, type: string, data: any) {
        res.write(`event:  ${type}\n`);
        res.write(`data:${JSON.stringify(data)}\n\n`);
    }

    private static sendSSEHeartbeat(res: Response) {
        res.write(': heartbeat\n\n');
    }

    /**
     * Helper to check user balance before starting resource-heavy operations
     */
    private static async checkUserBalance(userId: string): Promise<{ authorized: boolean; balance?: number; error?: string }> {
      try {
        const response = await axios.get(`${ENV.BILLING_SERVICE_URL}/backend/api/billing/balance`, {
          params: { userId },
          headers: {
            'x-internal-key': ENV.INTERNAL_SERVICE_SECRET
          }
        });

        const balance = response.data.balance || 0;
        const MINIMUM_BALANCE = 0.01; // Minimum to start

        if (balance < MINIMUM_BALANCE) {
          return { 
            authorized: false, 
            balance, 
            error: `Insufficient balance: $${balance.toFixed(4)}. Minimum $${MINIMUM_BALANCE} required to start.` 
          };
        }

        return { authorized: true, balance };
      } catch (error: any) {
        logger.error({ error: error.message }, 'Balance check failed in tools-service');
        return { authorized: false, error: 'Credit verification service is currently unavailable.' };
      }
    }

    // Knowledge Bases
    static async getKnowledgeBases(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.id;
            const { name, id, page = 1, limit = 10 } = req.query;
            const offset = (Number(page) - 1) * Number(limit);

            let query = `
                SELECT kb.*, 
                (SELECT COUNT(*) FROM knowledge_documents WHERE knowledge_id = kb.id) as "documentCount",
                COUNT(*) OVER() as "totalCount"
                FROM knowledge_bases kb 
                WHERE (user_id = $1 OR visibility = 'public')
            `;
            const params: any[] = [userId];
            let paramCount = 1;

            if (name) {
                paramCount++;
                query += ` AND kb.name ILIKE $${paramCount}`;
                params.push(`%${name}%`);
            }

            if (id) {
                paramCount++;
                query += ` AND kb.id::text = $${paramCount}`;
                params.push(id);
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            const total = result.rows.length > 0 ? parseInt(result.rows[0].totalCount) : 0;

            res.json({
                items: result.rows.map(({ totalCount, ...rest }) => rest),
                total,
                page: Number(page),
                limit: Number(limit)
            });
        } catch (error) {
            logger.error({ error }, 'Failed to fetch knowledge bases');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async createKnowledgeBase(req: AuthenticatedRequest, res: Response) {
        try {
            const { name, description, visibility = 'private' } = req.body;
            const userId = req.user?.id;

            const result = await pool.query(
                'INSERT INTO knowledge_bases (user_id, name, description, status, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, name, description, 'active', visibility]
            );

            res.status(201).json(result.rows[0]);
        } catch (error) {
            logger.error({ error }, 'Failed to create knowledge base');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async updateKnowledgeBase(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const { name, description, visibility } = req.body;
            const userId = req.user?.id;

            const result = await pool.query(
                'UPDATE knowledge_bases SET name = $1, description = $2, visibility = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND user_id = $5 RETURNING *',
                [name, description, visibility, id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Knowledge base not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            logger.error({ error }, 'Failed to update knowledge base');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async deleteKnowledgeBase(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            await pool.query('DELETE FROM knowledge_bases WHERE id = $1 AND user_id = $2', [id, userId]);
            res.status(204).send();
        } catch (error) {
            logger.error({ error }, 'Failed to delete knowledge base');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // Knowledge Graphs
    static async getKnowledgeGraphs(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.id;
            const { name, id, page = 1, limit = 10 } = req.query;
            const offset = (Number(page) - 1) * Number(limit);

            let query = `
                SELECT kg.*,
                (SELECT COUNT(*) FROM knowledge_documents WHERE knowledge_id = kg.id) as "documentCount",
                (SELECT COUNT(*) FROM knowledge_graph_nodes WHERE knowledge_id = kg.id) as "node_count",
                (SELECT COUNT(*) FROM knowledge_graph_relations WHERE knowledge_id = kg.id) as "relation_count",
                COUNT(*) OVER() as "totalCount"
                FROM knowledge_graphs kg 
                WHERE (user_id = $1 OR visibility = 'public')
            `;
            const params: any[] = [userId];
            let paramCount = 1;

            if (name) {
                paramCount++;
                query += ` AND kg.name ILIKE $${paramCount}`;
                params.push(`%${name}%`);
            }

            if (id) {
                paramCount++;
                query += ` AND kg.id::text = $${paramCount}`;
                params.push(id);
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            const total = result.rows.length > 0 ? parseInt(result.rows[0].totalCount) : 0;

            res.json({
                items: result.rows.map(({ totalCount, ...rest }) => rest),
                total,
                page: Number(page),
                limit: Number(limit)
            });
        } catch (error) {
            logger.error({ error }, 'Failed to fetch knowledge graphs');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async createKnowledgeGraph(req: AuthenticatedRequest, res: Response) {
        try {
            const { name, description, visibility = 'private' } = req.body;
            const userId = req.user?.id;

            const result = await pool.query(
                'INSERT INTO knowledge_graphs (user_id, name, description, status, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [userId, name, description, 'active', visibility]
            );

            res.status(201).json(result.rows[0]);
        } catch (error) {
            logger.error({ error }, 'Failed to create knowledge graph');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async updateKnowledgeGraph(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const { name, description, visibility } = req.body;
            const userId = req.user?.id;

            const result = await pool.query(
                'UPDATE knowledge_graphs SET name = $1, description = $2, visibility = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND user_id = $5 RETURNING *',
                [name, description, visibility, id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Knowledge graph not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            logger.error({ error }, 'Failed to update knowledge graph');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async deleteKnowledgeGraph(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            await pool.query('DELETE FROM knowledge_graphs WHERE id = $1 AND user_id = $2', [id, userId]);
            res.status(204).send();
        } catch (error) {
            logger.error({ error }, 'Failed to delete knowledge graph');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // Documents
    static async getKnowledgeDocuments(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params; // knowledge_id
            const result = await pool.query(
                'SELECT * FROM knowledge_documents WHERE knowledge_id = $1 ORDER BY uploaded_at DESC',
                [id]
            );
            res.json(result.rows);
        } catch (error) {
            logger.error({ error }, 'Failed to fetch knowledge documents');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async uploadDocuments(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params; // knowledge_id
            const { type } = req.query; // 'base' or 'graph'
            const files = req.files as Express.Multer.File[];
            const authHeader = req.headers.authorization || '';
            const userId = req.user?.id || 'system';

            // PRE-CHECK: Check user balance
            const balanceCheck = await KnowledgeController.checkUserBalance(userId);
            if (!balanceCheck.authorized) {
                return res.status(402).json({ 
                    error: 'Insufficient Balance', 
                    message: balanceCheck.error,
                    balance: balanceCheck.balance
                });
            }

            if (!files || files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }

            const uploadResults = [];
            const storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3003';

            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file.buffer, {
                    filename: file.originalname,
                    contentType: file.mimetype,
                });

                const storageResponse = await axios.post(
                    `${storageServiceUrl}/backend/api/storage/upload`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            'Authorization': authHeader
                        }
                    }
                );

                const storageData = storageResponse.data;
                const storageId = storageData.metadata.id;
                const fileUrl = storageData.url;

                const result = await pool.query(
                    `INSERT INTO knowledge_documents 
                    (knowledge_id, knowledge_type, storage_id, file_name, file_size, file_type, file_url, status) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                    [id, type, storageId, file.originalname, file.size, file.mimetype, fileUrl, 'pending']
                );

                uploadResults.push(result.rows[0]);
            }

            const docIds = uploadResults.map(doc => doc.id);
            let workflowId = '';
            // userId is already declared above

            if (type === 'base') {
                workflowId = await KnowledgeService.triggerIngestion(id as string, docIds, authHeader as string, userId);
            } else if (type === 'graph') {
                workflowId = await GraphService.triggerIngestion(id as string, docIds, authHeader as string, userId);
            }

            res.json({ success: true, documents: uploadResults, workflowId, status: 'processing' });
        } catch (error: any) {
            logger.error({ error: error.message }, 'Failed to upload knowledge documents');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async deleteDocument(req: AuthenticatedRequest, res: Response) {
        try {
            const docId = req.params.docId as string;
            const docResult = await pool.query('SELECT knowledge_id FROM knowledge_documents WHERE id = $1', [docId]);
            if (docResult.rows.length > 0) {
                const knowledgeId = docResult.rows[0].knowledge_id;
                await GraphService.deleteGraphData(knowledgeId, docId);
            }
            await pool.query('DELETE FROM knowledge_documents WHERE id = $1', [docId]);
            res.status(204).send();
        } catch (error) {
            logger.error({ error }, 'Failed to delete knowledge document');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async queryKnowledgeBase(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const { query, limit = 5 } = req.body;
            if (!query) return res.status(400).json({ error: 'Query is required' });
            
            // PRE-CHECK: Check user balance
            const userId = req.user?.id || 'system';
            const balanceCheck = await KnowledgeController.checkUserBalance(userId);
            if (!balanceCheck.authorized) {
                return res.status(402).json({ 
                    error: 'Insufficient Balance', 
                    message: balanceCheck.error,
                    balance: balanceCheck.balance
                });
            }

            const { results, usage } = await KnowledgeService.searchKnowledgeBase(id as string, query, limit);
            
            // Record usage asynchronously
            if (usage) {
                const execution_id = `kb-search-${Date.now()}`;
                axios.post(`${ENV.PLATFORM_SERVICE_URL}/backend/api/platform/usage`, {
                    execution_id,
                    resource_id: id,
                    resource_type: 'knowledge-base',
                    action_type: 'search',
                    user_id: userId,
                    total_input_tokens: usage.prompt_tokens,
                    total_completion_tokens: usage.completion_tokens || 0,
                    total_tokens: usage.total_tokens,
                    total_cost: usage.total_cost,
                    llm_calls: [usage]
                }, {
                    headers: {
                        'x-internal-key': ENV.INTERNAL_SERVICE_SECRET
                    }
                }).catch(err => logger.error({ err }, 'Failed to record KB search usage'));
            }

            res.json(results);
        } catch (error: any) {
            logger.error({ error: error.message }, 'Knowledge base query failed');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async queryKnowledgeGraph(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;
            const { query, depth = 2 } = req.body;
            const userId = req.user?.id || 'system';
            
            // PRE-CHECK: Check user balance
            const balanceCheck = await KnowledgeController.checkUserBalance(userId);
            if (!balanceCheck.authorized) {
                return res.status(402).json({ 
                    error: 'Insufficient Balance', 
                    message: balanceCheck.error,
                    balance: balanceCheck.balance
                });
            }

            const results = await GraphService.searchGraph(id as string, query, depth);
            res.json(results);
        } catch (error: any) {
            logger.error({ error: error.message }, 'Failed to query knowledge graph');
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    static async subscribeToIngestion(req: AuthenticatedRequest, res: Response) {
        const { workflowId } = req.params;
        const { namespace = 'knowledge-base' } = req.query; // knowledge-base or knowledge-graph

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders ? res.flushHeaders() : null;

        try {
            const client = await getTemporalClient(namespace as string);
            const handle = client.workflow.getHandle(workflowId as string);

            try {
                await handle.describe();
            } catch (e) {
                if (e instanceof WorkflowNotFoundError) {
                    KnowledgeController.sendSSEEvent(res, 'Error', { message: 'Workflow not found' });
                    res.end();
                    return;
                }
                throw e;
            }

            KnowledgeController.sendSSEEvent(res, 'WorkflowStarted', { workflowId, namespace });

            let currentEventCount = 0;
            let heartBeatTick = 0;

            const pollInterval = setInterval(async () => {
                try {
                    heartBeatTick++;
                    if (heartBeatTick % 5 === 0) KnowledgeController.sendSSEHeartbeat(res);

                    const events = await handle.query('getEvents');
                    if (events && (events as any[]).length > currentEventCount) {
                        for (let i = currentEventCount; i < (events as any[]).length; i++) {
                            const event = (events as any[])[i];
                            KnowledgeController.sendSSEEvent(res, event.type, event.data);
                        }
                        currentEventCount = (events as any[]).length;
                    }

                    const isCompleted = await handle.query('isCompleted');
                    if (isCompleted) {
                        clearInterval(pollInterval);
                        res.end();
                    }
                } catch (error) {
                    clearInterval(pollInterval);
                    res.end();
                }
            }, 1000);

            res.on('close', () => clearInterval(pollInterval));
        } catch (error) {
            logger.error({ error, workflowId }, 'Failed to subscribe to ingestion workflow');
            res.end();
        }
    }
}
