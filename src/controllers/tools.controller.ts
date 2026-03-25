import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { ToolsService } from '../services/tools.service';
import logger from '../config/logger';

const toolsService = new ToolsService();

export class ToolsController {
    async getTools(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const search = req.query.search as string;
            const limit = parseInt(req.query.limit as string) || 10;
            const page = parseInt(req.query.page as string) || 1;
            const offset = (Math.max(1, page) - 1) * limit;

            const result = await toolsService.getTools(userId, search, limit, offset);
            res.json({
                ...result,
                page,
                totalPages: Math.ceil(result.total / limit)
            });
        } catch (error) {
            logger.error({ error }, 'Error fetching tools');
            res.status(500).json({ error: 'Failed to fetch tools' });
        }
    }

    async createTool(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.id || 'default-user';
            
            if (Array.isArray(req.body)) {
                // Assuming toolsService has a createTools method for an array of tools
                const tools = await toolsService.createTools(req.body, userId);
                res.status(201).json(tools);
            } else {
                const tool = await toolsService.createTool(req.body, userId);
                res.status(201).json(tool);
            }
        } catch (error) {
            logger.error({ error }, 'Controller: createTool failed');
            res.status(500).json({ error: 'Failed to create tool(s)' });
        }
    }

    async updateTool(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const id = req.params.id as string;
            const tool = await toolsService.updateTool(id, req.body, userId);
            if (!tool) return res.status(404).json({ error: 'Tool not found' });
            res.json(tool);
        } catch (error) {
            logger.error({ error }, 'Error updating tool');
            res.status(500).json({ error: 'Failed to update tool' });
        }
    }

    async deleteTool(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const id = req.params.id as string;
            const deleted = await toolsService.deleteTool(id, userId);
            if (!deleted) return res.status(404).json({ error: 'Tool not found' });
            res.status(204).send();
        } catch (error) {
            logger.error({ error }, 'Error deleting tool');
            res.status(500).json({ error: 'Failed to delete tool' });
        }
    }

    async checkConflicts(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { tools } = req.body;
            if (!Array.isArray(tools)) {
                return res.status(400).json({ error: 'Invalid input. Expected tools array.' });
            }
            const conflicts = await toolsService.checkConflicts(tools, userId);
            res.json(conflicts);
        } catch (error) {
            logger.error({ error }, 'Error checking for tool conflicts');
            res.status(500).json({ error: 'Failed to check conflicts' });
        }
    }

    async executeTool(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { name, parameters } = req.body;
            
            if (!name) {
                return res.status(400).json({ error: 'Tool name is required' });
            }

            const result = await toolsService.executeTool(name, parameters || {}, userId);
            res.json(result);
        } catch (error: any) {
            logger.error({ error }, 'Error executing tool');
            res.status(500).json({ error: error.message || 'Failed to execute tool' });
        }
    }
}
