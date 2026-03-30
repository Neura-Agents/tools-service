import { proxyActivities, defineQuery, setHandler, uuid4 } from '@temporalio/workflow';
import type * as activities from './activities';

const { 
  fetchDocument,
  downloadAndExtractText,
  updateDocumentStatus,
  chunkKBText,
  generateAndStoreEmbedding,
  updateKBStatus,
  logFailedKBIngestion,
  chunkKGText,
  extractAndSaveGraphChunk,
  finalizeKG,
  updateKGStatus,
  setKBProcessing,
  setKGProcessing,
  recordUsage
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '10s',
    maximumInterval: '1m',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// Define queries for SSE streaming
export const getEventsQuery = defineQuery<any[]>('getEvents');
export const isCompletedQuery = defineQuery<boolean>('isCompleted');

export async function KBIngestionWorkflow(knowledgeId: string, docIds: string[], authHeader: string, userId: string): Promise<void> {
  const events: any[] = [];
  let isCompleted = false;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, total_cost: 0 };
  const llmCalls: any[] = [];

  setHandler(getEventsQuery, () => events);
  setHandler(isCompletedQuery, () => isCompleted);

  const pushEvent = (type: string, data: any) => {
    events.push({ type, data, timestamp: Date.now() });
  };

  try {
    pushEvent('status', { message: 'Starting KB ingestion...', status: 'processing' });
    await setKBProcessing(knowledgeId);

    await Promise.all(
      docIds.map(async (docId) => {
        try {
          const doc = await fetchDocument(docId);
          pushEvent('doc_start', { docId, fileName: doc.file_name });
          
          await updateDocumentStatus(docId, 'processing');
          
          const text = await downloadAndExtractText(docId, authHeader);
          pushEvent('doc_progress', { docId, status: 'Extracted text' });
          
          const chunks = await chunkKBText(text);
          pushEvent('doc_progress', { docId, status: 'Chunked text', totalChunks: chunks.length });
          
          let chunksProcessed = 0;
          for (const chunk of chunks) {
            const usage = await generateAndStoreEmbedding(knowledgeId, docId, chunk);
            chunksProcessed++;
            
            if (usage) {
              totalUsage.prompt_tokens += usage.prompt_tokens || 0;
              totalUsage.completion_tokens += usage.completion_tokens || 0;
              totalUsage.total_tokens += usage.total_tokens || 0;
              totalUsage.total_cost += usage.total_cost || 0;
              llmCalls.push(usage);
            }

            pushEvent('doc_progress', { 
              docId, 
              status: 'Embedding chunks', 
              processedChunks: chunksProcessed, 
              totalChunks: chunks.length 
            });
          }
          
          await updateDocumentStatus(docId, 'completed');
          pushEvent('doc_completed', { docId });
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await updateDocumentStatus(docId, 'failed', errorMessage);
          await logFailedKBIngestion(docId, errorMessage);
          pushEvent('doc_failed', { docId, error: errorMessage });
        }
      })
    );

    // Record total usage for the ingestion
    if (totalUsage.total_tokens > 0) {
      await recordUsage({
        execution_id: `kb-ingest-${uuid4()}`,
        resource_id: knowledgeId,
        resource_type: 'knowledge-base',
        action_type: 'ingestion',
        user_id: userId,
        total_input_tokens: totalUsage.prompt_tokens,
        total_completion_tokens: totalUsage.completion_tokens,
        total_tokens: totalUsage.total_tokens,
        total_cost: totalUsage.total_cost,
        llm_calls: llmCalls
      });
    }

    await updateKBStatus(knowledgeId, docIds);
    pushEvent('status', { message: 'KB ingestion completed', status: 'active' });
  } finally {
    isCompleted = true;
  }
}

export async function KGIngestionWorkflow(knowledgeId: string, docIds: string[], authHeader: string, userId: string): Promise<void> {
  const events: any[] = [];
  let isCompleted = false;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, total_cost: 0 };
  const llmCalls: any[] = [];

  setHandler(getEventsQuery, () => events);
  setHandler(isCompletedQuery, () => isCompleted);

  const pushEvent = (type: string, data: any) => {
    events.push({ type, data, timestamp: Date.now() });
  };

  try {
    pushEvent('status', { message: 'Starting KG ingestion...', status: 'processing' });
    await setKGProcessing(knowledgeId);

    for (const docId of docIds) {
      try {
        const doc = await fetchDocument(docId);
        pushEvent('doc_start', { docId, fileName: doc.file_name });
        
        await updateDocumentStatus(docId, 'processing');
        
        const text = await downloadAndExtractText(docId, authHeader);
        pushEvent('doc_progress', { docId, status: 'Extracted text' });
        
        const chunks = await chunkKGText(text);
        pushEvent('doc_progress', { docId, status: 'Chunked text', totalChunks: chunks.length });
        
        let index = 0;
        for (const chunk of chunks) {
          index++;
          const usage = await extractAndSaveGraphChunk(knowledgeId, docId, chunk, index, chunks.length);
          
          if (usage) {
            totalUsage.prompt_tokens += usage.prompt_tokens || 0;
            totalUsage.completion_tokens += usage.completion_tokens || 0;
            totalUsage.total_tokens += usage.total_tokens || 0;
            totalUsage.total_cost += usage.total_cost || 0;
            llmCalls.push(usage);
          }

          pushEvent('doc_progress', { 
            docId, 
            status: 'Extracting graph data', 
            processedChunks: index, 
            totalChunks: chunks.length 
          });
        }
        
        await finalizeKG(knowledgeId, docId);
        pushEvent('doc_completed', { docId });
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await updateDocumentStatus(docId, 'failed', errorMessage);
        pushEvent('doc_failed', { docId, error: errorMessage });
      }
    }

    // Record total usage for the ingestion
    if (totalUsage.total_tokens > 0) {
      await recordUsage({
        execution_id: `kg-ingest-${uuid4()}`,
        resource_id: knowledgeId,
        resource_type: 'knowledge-graph',
        action_type: 'ingestion',
        user_id: userId,
        total_input_tokens: totalUsage.prompt_tokens,
        total_completion_tokens: totalUsage.completion_tokens,
        total_tokens: totalUsage.total_tokens,
        total_cost: totalUsage.total_cost,
        llm_calls: llmCalls
      });
    }

    await updateKGStatus(knowledgeId);
    pushEvent('status', { message: 'KG ingestion completed', status: 'active' });
  } finally {
    isCompleted = true;
  }
}
