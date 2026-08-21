import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToMongo(uri?: string) {
  const mongoUri = uri || config.mongoUri;
  if (!mongoUri) throw new Error('MongoDB URI not provided');

  if (client && db) {
    return db;
  }

  client = new MongoClient(mongoUri, { // options can be extended
    // useUnifiedTopology is default in recent drivers
  } as any);

  await client.connect();
  // default database from URI or explicit 'analytics'
  const dbName = (() => {
    try {
      const parsed = new URL(mongoUri.replace('mongodb://', 'http://'));
      return parsed.pathname && parsed.pathname.length > 1 ? parsed.pathname.slice(1) : 'analytics';
    } catch (e) {
      return 'analytics';
    }
  })();

  db = client.db(dbName);
  return db;
}

export function getMongoDb() {
  if (!db) throw new Error('MongoDB not connected. Call connectToMongo first.');
  return db;
}

export function getMongoClient() {
  if (!client) throw new Error('MongoDB client not connected. Call connectToMongo first.');
  return client;
}

export async function closeMongo() {
  if (client) await client.close();
  client = null;
  db = null;
}
