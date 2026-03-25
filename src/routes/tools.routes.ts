import { Router } from 'express';
import { ToolsController } from '../controllers/tools.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
const controller = new ToolsController();

// All routes require authentication
router.use(authenticate);

router.get('/', (req, res) => controller.getTools(req as any, res));
router.post('/', (req, res) => controller.createTool(req as any, res));
router.post('/conflicts', (req, res) => controller.checkConflicts(req as any, res));
router.post('/execute', (req, res) => controller.executeTool(req as any, res));
router.put('/:id', (req, res) => controller.updateTool(req as any, res));
router.delete('/:id', (req, res) => controller.deleteTool(req as any, res));

export default router;
