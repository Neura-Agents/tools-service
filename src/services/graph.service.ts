import axios from 'axios';
import { pool } from '../config/db.config';
import { getNeo4jDriver } from '../config/neo4j.config';
import logger from '../config/logger';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ENV } from '../config/env.config';
import { getTemporalClient } from '../temporal/client';
import { v4 as uuidv4 } from 'uuid';
const pdf = require('pdf-parse');

interface GraphNode {
    name: string;
    type: string;
    description: string;
    properties?: any;
}

interface GraphRelation {
    from: string;
    to: string;
    type: string;
    description: string;
    properties?: any;
}

export class GraphService {
    private static splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 2000, 
        chunkOverlap: 200,
    });

    private static litellmUrl = ENV.AI_GATEWAY_URL;
    private static litellmKey = ENV.AI_GATEWAY_KEY;
    private static extractionModel = 'gpt-oss-120b';

    static async getDocument(docId: string): Promise<any> {
        const docResult = await pool.query('SELECT * FROM knowledge_documents WHERE id = $1', [docId]);
        if (docResult.rows.length === 0) throw new Error('Document not found');
        return docResult.rows[0];
    }

    static async extractText(doc: any, authHeader: string): Promise<string> {
        const storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3003';
        const response = await axios.get(`${storageServiceUrl}/backend/api/storage/view/${doc.storage_id}`, {
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
                const pdfParseFn = typeof pdf === 'function' ? pdf : (pdf?.default || pdf);
                if (typeof pdfParseFn !== 'function') {
                    throw new Error('PDF parsing library is not correctly loaded as a function');
                }
                const data = await pdfParseFn(fileBuffer);
                text = data.text;
            }
        } else {
            text = fileBuffer.toString('utf-8');
        }
        return text;
    }

    static async chunkText(text: string): Promise<string[]> {
        const chunks = await this.splitter.createDocuments([text]);
        return chunks.map(c => c.pageContent);
    }

    static async extractGraphData(text: string): Promise<{ nodes: GraphNode[], relations: GraphRelation[] }> {
        const prompt = `
Extract all entities and their physical or logical relations from the following text.
Format the output as a JSON object with exactly two arrays: 'nodes' and 'relations'.
- Each node must have 'name', 'type', and 'description'.
- Each relation must have 'from' (node name), 'to' (node name), 'type', and 'description'.

Return ONLY the JSON object. Do not include markdown formatting or explanations.

Text:
${text}
`;

        try {
            const response = await axios.post(
                `${this.litellmUrl}/chat/completions`,
                {
                    model: this.extractionModel,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0,
                    response_format: { type: "json_object" }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.litellmKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            let content = response.data.choices[0].message.content;
            content = content.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
            return JSON.parse(content);
        } catch (error: any) {
            logger.error({ error: error.message, model: this.extractionModel }, 'Failed to extract graph data');
            return { nodes: [], relations: [] };
        }
    }

    static async saveGraphChunk(knowledgeId: string, documentId: string, nodes: GraphNode[], relations: GraphRelation[]): Promise<void> {
        const neo4jLabel = `KB_${knowledgeId.replace(/-/g, '_')}`;
        const driver = getNeo4jDriver();
        const nodeNameToId: Record<string, string> = {};

        for (const node of nodes) {
            try {
                const pgResult = await pool.query(
                    `INSERT INTO knowledge_graph_nodes (knowledge_id, document_id, name, type, properties) 
                     VALUES ($1, $2, $3, $4, $5) 
                     ON CONFLICT (knowledge_id, name) DO UPDATE SET type = EXCLUDED.type, properties = EXCLUDED.properties, document_id = EXCLUDED.document_id
                     RETURNING id`,
                    [knowledgeId, documentId, node.name, node.type, JSON.stringify({ description: node.description, ...node.properties })]
                );
                nodeNameToId[node.name] = pgResult.rows[0].id;

                const session = driver.session();
                try {
                    await session.run(
                        `MERGE (n:${neo4jLabel} {name: $name})
                         SET n.type = $type, n.description = $description, n.knowledge_id = $knowledgeId, n.document_id = $documentId`,
                        { name: node.name, type: node.type, description: node.description, knowledgeId, documentId }
                    );
                } finally {
                    await session.close();
                }
            } catch (err) {
                logger.warn({ node: node.name, error: err }, 'Failed to save node');
            }
        }

        for (const rel of relations) {
            const fromId = nodeNameToId[rel.from];
            const toId = nodeNameToId[rel.to];
            if (fromId && toId) {
                try {
                    await pool.query(
                        `INSERT INTO knowledge_graph_relations (knowledge_id, document_id, from_node_id, to_node_id, relation_type, properties) 
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [knowledgeId, documentId, fromId, toId, rel.type, JSON.stringify({ description: rel.description, ...rel.properties })]
                    );

                    const session = driver.session();
                    try {
                        const cypherType = rel.type.toUpperCase().replace(/\s+/g, '_');
                        await session.run(
                            `MATCH (a:${neo4jLabel} {name: $from}), (b:${neo4jLabel} {name: $to})
                             MERGE (a)-[r:${cypherType}]->(b)
                             SET r.description = $description, r.document_id = $documentId`,
                            { from: rel.from, to: rel.to, description: rel.description, documentId }
                        );
                    } finally {
                        await session.close();
                    }
                } catch (err) {
                    logger.warn({ relation: rel, error: err }, 'Failed to save relation');
                }
            }
        }
    }

    static async updateGraphStats(knowledgeId: string): Promise<void> {
        const nodeCount = await pool.query('SELECT COUNT(*) FROM knowledge_graph_nodes WHERE knowledge_id = $1', [knowledgeId]);
        const relCount = await pool.query('SELECT COUNT(*) FROM knowledge_graph_relations WHERE knowledge_id = $1', [knowledgeId]);
        
        await pool.query(
            'UPDATE knowledge_graphs SET node_count = $1, relation_count = $2 WHERE id = $3',
            [parseInt(nodeCount.rows[0].count), parseInt(relCount.rows[0].count), knowledgeId]
        );
    }

    static async searchGraph(knowledgeId: string, query: string, depth: number = 2): Promise<any> {
        const driver = getNeo4jDriver();
        const session = driver.session();
        const neo4jLabel = `KB_${knowledgeId.replace(/-/g, '_')}`;

        try {
            const result = await session.run(
                `MATCH (n:${neo4jLabel})
                 WHERE n.name CONTAINS $query OR n.description CONTAINS $query
                 MATCH path = (n)-[*1..${depth}]-(m:${neo4jLabel})
                 RETURN path LIMIT 50`,
                { query, depth }
            );

            return result.records.map(record => record.get('path'));
        } finally {
            await session.close();
        }
    }

    static async deleteGraphData(knowledgeId: string, documentId: string): Promise<void> {
        const driver = getNeo4jDriver();
        const session = driver.session();
        const neo4jLabel = `KB_${knowledgeId.replace(/-/g, '_')}`;

        try {
            await session.run(
                `MATCH (n:${neo4jLabel} {document_id: $documentId})
                 DETACH DELETE n`,
                { documentId }
            );
            
            await session.run(
                `MATCH (:${neo4jLabel})-[r {document_id: $documentId}]->(:${neo4jLabel})
                 DELETE r`,
                { documentId }
            );
        } finally {
            await session.close();
        }
    }

    static async triggerIngestion(knowledgeId: string, docIds: string[], authHeader: string): Promise<string> {
        try {
            const client = await getTemporalClient('knowledge-graph');
            const workflowId = `kg-ingestion-${knowledgeId}-${uuidv4()}`;
            logger.info({ knowledgeId, workflowId }, 'Starting KG ingestion workflow via Temporal');
            await client.workflow.start('KGIngestionWorkflow', {
                args: [knowledgeId, docIds, authHeader],
                taskQueue: 'kg-ingestion-queue',
                workflowId,
            });
            return workflowId;
        } catch (error) {
            logger.error({ knowledgeId, error }, 'Failed to start Graph ingestion workflow');
            await pool.query('UPDATE knowledge_graphs SET status = $1 WHERE id = $2', ['failed', knowledgeId]);
            throw error;
        }
    }

    static async updateDocumentProgress(docId: string, processed: number, total: number): Promise<void> {
        await pool.query('UPDATE knowledge_documents SET processed_chunks = $1, total_chunks = $2 WHERE id = $3', [processed, total, docId]);
    }

    static async completeDocument(docId: string): Promise<void> {
        await pool.query("UPDATE knowledge_documents SET status = 'completed' WHERE id = $1", [docId]);
    }
}
