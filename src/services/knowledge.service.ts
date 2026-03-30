import axios from 'axios';
import { pool } from '../config/db.config';
import logger from '../config/logger';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getTemporalClient } from '../temporal/client';
import { v4 as uuidv4 } from 'uuid';
const pdf = require('pdf-parse');

export class KnowledgeService {
    private static splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });

    private static litellmUrl = process.env.AI_GATEWAY_URL || 'http://localhost:4000';
    private static litellmKey = process.env.AI_GATEWAY_KEY || 'sk-1234';
    private static embeddingModel = process.env.EMBEDDING_MODEL || 'llama-nemotron-embed-1b-v2';

    private static storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3003';

    static async getDocument(docId: string): Promise<any> {
        const docResult = await pool.query('SELECT * FROM knowledge_documents WHERE id = $1', [docId]);
        if (docResult.rows.length === 0) throw new Error('Document not found');
        return docResult.rows[0];
    }

    static async updateDocumentStatus(docId: string, status: string, errorMessage?: string): Promise<void> {
        await pool.query(
            'UPDATE knowledge_documents SET status = $1, error_message = $2 WHERE id = $3',
            [status, errorMessage || null, docId]
        );
    }

    static async downloadAndExtractText(doc: any, authHeader: string): Promise<string> {
        const response = await axios.get(`${this.storageServiceUrl}/backend/api/storage/view/${doc.storage_id}`, {
            headers: { 'Authorization': authHeader },
            responseType: 'arraybuffer'
        });
        const fileBuffer = Buffer.from(response.data);

        let text = '';
        if (doc.file_type === 'application/pdf') {
            if (pdf.PDFParse && typeof pdf.PDFParse === 'function') {
                const parser = new pdf.PDFParse({ data: fileBuffer });
                try {
                    const result = await parser.getText();
                    text = result.text;
                } finally {
                    if (typeof parser.destroy === 'function') {
                        await parser.destroy();
                    }
                }
            } else {
                const pdfParseFn = typeof pdf === 'function' ? pdf : (pdf.default || pdf);
                if (typeof pdfParseFn !== 'function') {
                    throw new Error('PDF parsing library is not correctly loaded as a function');
                }
                const data = await pdfParseFn(fileBuffer);
                text = data.text;
            }
        } else {
            text = fileBuffer.toString('utf-8');
        }

        if (!text || text.trim().length === 0) {
            throw new Error('No text extracted from document');
        }
        return text;
    }

    static async chunkText(text: string): Promise<string[]> {
        const chunks = await this.splitter.createDocuments([text]);
        return chunks.map(c => c.pageContent);
    }

    static async generateAndStoreEmbedding(knowledgeId: string, docId: string, content: string): Promise<any> {
        const { embedding, usage } = await this.generateEmbedding(content);
        await pool.query(
            'INSERT INTO knowledge_embeddings (knowledge_id, document_id, content, embedding) VALUES ($1, $2, $3, $4)',
            [knowledgeId, docId, content, `[${embedding.join(',')}]`]
        );
        return usage;
    }

    static async logFailedIngestion(docId: string, errorMessage: string): Promise<void> {
        const doc = await this.getDocument(docId);
        await pool.query(
            'INSERT INTO uningested_pipeline (knowledge_id, document_id, file_name, error_message) VALUES ($1, $2, $3, $4)',
            [doc.knowledge_id, doc.id, doc.file_name, errorMessage]
        );
    }

    static async generateEmbedding(text: string, inputType: 'passage' | 'query' = 'passage'): Promise<{ embedding: number[], usage: any }> {
        try {
            const response = await axios.post(
                `${this.litellmUrl}/embeddings`,
                {
                    model: this.embeddingModel,
                    input: text,
                    input_type: inputType
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.litellmKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const embedding = response.data.data[0].embedding;
            const usage = response.data.usage || { prompt_tokens: 0, total_tokens: 0 };
            
            // LiteLLM might provide cost in headers or usage
            const costHeader = response.headers['x-litellm-response-cost'] || response.headers['x-litellm-cost'];
            usage.total_cost = usage.total_cost || (costHeader ? parseFloat(costHeader) : 0);
            
            // Add model info for usage tracking
            usage.model = this.embeddingModel;

            return { embedding, usage };
        } catch (error: any) {
            logger.error({ 
                error: error.message, 
                errorData: error.response?.data, 
                model: this.embeddingModel
            }, 'LiteLLM embedding call failed');
            throw error;
        }
    }

    static async triggerIngestion(knowledgeId: string, docIds: string[], authHeader: string, userId: string): Promise<string> {
        try {
            const client = await getTemporalClient('knowledge-base');
            const workflowId = `kb-ingestion-${knowledgeId}-${uuidv4()}`;

            logger.info({ knowledgeId, workflowId }, 'Starting KB ingestion workflow via Temporal');

            await client.workflow.start('KBIngestionWorkflow', {
                args: [knowledgeId, docIds, authHeader, userId],
                taskQueue: 'kb-ingestion-queue',
                workflowId,
            });

            return workflowId;
        } catch (error) {
            logger.error({ knowledgeId, error }, 'Failed to start KB ingestion workflow');
            await pool.query('UPDATE knowledge_bases SET status = $1 WHERE id = $2', ['failed', knowledgeId]);
            throw error;
        }
    }

    static async searchKnowledgeBase(knowledgeId: string, query: string, limit: number = 5): Promise<{ results: any[], usage: any }> {
        try {
            const { embedding: queryEmbedding, usage } = await this.generateEmbedding(query, 'query');
            const result = await pool.query(
                `SELECT content, 1 - (embedding <=> $1) as similarity 
                 FROM knowledge_embeddings 
                 WHERE knowledge_id = $2 
                 ORDER BY embedding <=> $1 
                 LIMIT $3`,
                [`[${queryEmbedding.join(',')}]`, knowledgeId, limit]
            );
            return { results: result.rows, usage };
        } catch (error) {
            logger.error({ knowledgeId, query, error }, 'Knowledge base search failed');
            throw error;
        }
    }
}
