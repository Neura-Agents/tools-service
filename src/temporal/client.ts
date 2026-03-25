import { Connection, Client } from '@temporalio/client';
import logger from '../config/logger';

const clients = new Map<string, Client>();
let connection: Connection | null = null;

async function getConnection(): Promise<Connection> {
  if (connection) return connection;

  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  logger.info({ address }, 'Connecting to Temporal server');
  
  connection = await Connection.connect({
    address,
  });
  return connection;
}

export async function getTemporalClient(namespace: string = 'default'): Promise<Client> {
  if (clients.has(namespace)) return clients.get(namespace)!;

  const conn = await getConnection();
  const client = new Client({
    connection: conn,
    namespace: namespace, // Using the specifically requested namespace
  });

  clients.set(namespace, client);
  return client;
}
