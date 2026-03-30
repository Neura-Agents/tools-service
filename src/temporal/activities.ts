import { KnowledgeService } from '../services/knowledge.service';
import { GraphService } from '../services/graph.service';
import { pool } from '../config/db.config';
import logger from '../config/logger';
import axios from 'axios';
import { ENV } from '../config/env.config';

// --- SHARED ACTIVITIES ---

export async function fetchDocument(docId: string): Promise<any> {
    return await KnowledgeService.getDocument(docId);
}

export async function downloadAndExtractText(docId: string, authHeader: string): Promise<string> {
    const doc = await KnowledgeService.getDocument(docId);
    return await KnowledgeService.downloadAndExtractText(doc, authHeader);
}

export async function updateDocumentStatus(docId: string, status: string, error?: string): Promise<void> {
    await KnowledgeService.updateDocumentStatus(docId, status, error);
}

export async function checkBalance(userId: string, minAmount: number = 0.01): Promise<void> {
    try {
        const billingServiceUrl = ENV.BILLING_SERVICE_URL || 'http://billing-service:3007';
        const response = await axios.get(`${billingServiceUrl}/backend/api/billing/balance`, {
            params: { userId },
            headers: {
                'x-internal-key': ENV.INTERNAL_SERVICE_SECRET
            }
        });
        
        const balance = parseFloat(response.data.balance || '0');
        if (balance < minAmount) {
            throw new Error(`Insufficient balance: $${balance}. Minimum $${minAmount} required.`);
        }
    } catch (error: any) {
        if (error.message.includes('Insufficient balance')) throw error;
        logger.error({ error: error.message }, 'Failed to check balance');
        // Be permissive if billing service is down, or strict?
        if (error.response?.status === 402) {
            throw new Error('Insufficient credits.');
        }
    }
}

/**
 * Common activity to record usage in the platform-service.
 */
export async function recordUsage(usage: any): Promise<void> {
    try {
        await axios.post(`${ENV.PLATFORM_SERVICE_URL}/backend/api/platform/usage`, usage, {
            headers: {
                'x-internal-key': ENV.INTERNAL_SERVICE_SECRET
            }
        });
    } catch (error: any) {
        const errorData = error.response?.data || error.message;
        logger.error({ 
            error: error.message, 
            details: errorData 
        }, 'Failed to record usage in platform-service');

        // Explicitly handle credit termination signal
        if (error.response?.status === 402 || (typeof errorData === 'string' && errorData.includes('TERMINATE_EXECUTION'))) {
            throw new Error('Insufficient credits to continue ingestion.');
        }
    }
}

// --- KNOWLEDGE BASE ACTIVITIES ---

export async function chunkKBText(text: string): Promise<string[]> {
    return await KnowledgeService.chunkText(text);
}

export async function generateAndStoreEmbedding(knowledgeId: string, docId: string, content: string): Promise<any> {
    return await KnowledgeService.generateAndStoreEmbedding(knowledgeId, docId, content);
}

export async function updateKBStatus(knowledgeId: string, docIds: string[]): Promise<void> {
    const failedDocs = await pool.query(
        'SELECT COUNT(*) FROM knowledge_documents WHERE id = ANY($1) AND status = $2',
        [docIds, 'failed']
    );
    const failedCount = parseInt(failedDocs.rows[0].count);
    const failureRate = (failedCount / docIds.length) * 100;
    const finalStatus = failureRate > 30 ? 'failed' : 'active';

    await pool.query('UPDATE knowledge_bases SET status = $1 WHERE id = $2', [finalStatus, knowledgeId]);
    logger.info({ knowledgeId, finalStatus }, 'KB ingestion workflow finalized');
}

export async function logFailedKBIngestion(docId: string, error: string): Promise<void> {
    await KnowledgeService.logFailedIngestion(docId, error);
}

// --- KNOWLEDGE GRAPH ACTIVITIES ---

export async function chunkKGText(text: string): Promise<string[]> {
    return await GraphService.chunkText(text);
}

export async function extractAndSaveGraphChunk(knowledgeId: string, docId: string, text: string, chunkIndex: number, totalChunks: number): Promise<any> {
    const { nodes, relations, usage } = await GraphService.extractGraphData(text);
    await GraphService.saveGraphChunk(knowledgeId, docId, nodes, relations);
    await GraphService.updateDocumentProgress(docId, chunkIndex, totalChunks);
    return usage;
}

export async function finalizeKG(knowledgeId: string, docId: string): Promise<void> {
    await GraphService.updateGraphStats(knowledgeId);
    await GraphService.completeDocument(docId);
}

export async function updateKGStatus(knowledgeId: string): Promise<void> {
    await pool.query('UPDATE knowledge_graphs SET status = $1 WHERE id = $2', ['active', knowledgeId]);
}

export async function setKBProcessing(knowledgeId: string): Promise<void> {
    await pool.query('UPDATE knowledge_bases SET status = $1 WHERE id = $2', ['processing', knowledgeId]);
}

export async function setKGProcessing(knowledgeId: string): Promise<void> {
    await pool.query('UPDATE knowledge_graphs SET status = $1 WHERE id = $2', ['processing', knowledgeId]);
}
