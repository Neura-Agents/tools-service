import { proxyActivities, defineQuery, setHandler } from '@temporalio/workflow';
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
  setKGProcessing
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

export async function KBIngestionWorkflow(knowledgeId: string, docIds: string[], authHeader: string): Promise<void> {
  const events: any[] = [];
  let isCompleted = false;

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
          await Promise.all(
            chunks.map(async (chunk) => {
              await generateAndStoreEmbedding(knowledgeId, docId, chunk);
              chunksProcessed++;
              pushEvent('doc_progress', { 
                docId, 
                status: 'Embedding chunks', 
                processedChunks: chunksProcessed, 
                totalChunks: chunks.length 
              });
            })
          );
          
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

    await updateKBStatus(knowledgeId, docIds);
    pushEvent('status', { message: 'KB ingestion completed', status: 'active' });
  } finally {
    isCompleted = true;
  }
}

export async function KGIngestionWorkflow(knowledgeId: string, docIds: string[], authHeader: string): Promise<void> {
  const events: any[] = [];
  let isCompleted = false;

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
          await extractAndSaveGraphChunk(knowledgeId, docId, chunk, index, chunks.length);
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

    await updateKGStatus(knowledgeId);
    pushEvent('status', { message: 'KG ingestion completed', status: 'active' });
  } finally {
    isCompleted = true;
  }
}
