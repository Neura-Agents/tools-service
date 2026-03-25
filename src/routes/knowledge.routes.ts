import { Router } from 'express';
import { KnowledgeController } from '../controllers/knowledge.controller';
import { authenticate } from '../middlewares/auth.middleware';
import multer from 'multer';

const router = Router();
const upload = multer();

// Authentication middleware applied for all routes
router.use(authenticate);

// Knowledge Bases
router.get('/bases', KnowledgeController.getKnowledgeBases);
router.post('/bases', KnowledgeController.createKnowledgeBase);
router.put('/bases/:id', KnowledgeController.updateKnowledgeBase);
router.delete('/bases/:id', KnowledgeController.deleteKnowledgeBase);

// Knowledge Graphs
router.get('/graphs', KnowledgeController.getKnowledgeGraphs);
router.post('/graphs', KnowledgeController.createKnowledgeGraph);
router.put('/graphs/:id', KnowledgeController.updateKnowledgeGraph);
router.delete('/graphs/:id', KnowledgeController.deleteKnowledgeGraph);

// Documents
router.get('/:id/documents', KnowledgeController.getKnowledgeDocuments);
router.post('/:id/upload', upload.array('files'), KnowledgeController.uploadDocuments);
router.post('/bases/:id/query', KnowledgeController.queryKnowledgeBase);
router.post('/graphs/:id/query', KnowledgeController.queryKnowledgeGraph);
router.delete('/documents/:docId', KnowledgeController.deleteDocument);

// SSE Subscription
router.get('/ingestion/subscribe/:workflowId', KnowledgeController.subscribeToIngestion);

export default router;
