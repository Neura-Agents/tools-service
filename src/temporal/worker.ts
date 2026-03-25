import { Worker, NativeConnection } from '@temporalio/worker';
import { Connection } from '@temporalio/client';
import * as activities from './activities';
import logger from '../config/logger';

async function ensureNamespace(name: string, address: string) {
  try {
    const connection = await Connection.connect({ address });
    const service = connection.workflowService;
    
    logger.info({ name, address }, 'Checking/Registering Temporal namespace...');
    await service.registerNamespace({
      namespace: name,
      workflowExecutionRetentionPeriod: { seconds: String(60 * 60 * 24 * 7) }, // 7 days
    });
    logger.info({ name }, 'Namespace registered successfully');
  } catch (error: any) {
    if (error.name === 'NamespaceAlreadyExistsError' || error.message?.includes('already exists')) {
      logger.info({ name }, 'Namespace already exists, continuing...');
    } else {
      logger.warn({ name, error: error.message }, 'Failed to register namespace (it might already exist or server is unreachable)');
    }
  }
}

async function run() {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  // 1. Ensure namespaces exist before starting workers
  await ensureNamespace('knowledge-base', address);
  await ensureNamespace('knowledge-graph', address);

  // 2. NativeConnection is recommended for workers
  const connection = await NativeConnection.connect({
    address,
  });

  // 3. Worker for Knowledge Base (KB) Ingestion
  const kbWorker = await Worker.create({
    connection,
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'kb-ingestion-queue',
    namespace: 'knowledge-base', 
  });

  // 4. Worker for Knowledge Graph (KG) Ingestion
  const kgWorker = await Worker.create({
    connection,
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'kg-ingestion-queue',
    namespace: 'knowledge-graph',
  });

  logger.info({ address }, 'Temporal workers starting for namespaces: knowledge-base, knowledge-graph');

  // Start both workers concurrently
  await Promise.all([
    kbWorker.run(),
    kgWorker.run(),
  ]);
}

run().catch((err) => {
  logger.error({ err }, 'Temporal worker orchestration failed');
  process.exit(1);
});
