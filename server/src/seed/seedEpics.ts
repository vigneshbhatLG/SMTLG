/**
 * One-time seed: inserts/updates epics for teamId 3 in part_teams collection.
 * Run with:  npx ts-node server/src/seed/seedEpics.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { connectToMongo, getMongoDb, closeMongo } from '../utils/mongo';

const TEAM_ID = 3;

const EPICS = [
  { key: 'TVPLAT-805012', name: '[MS_SystemApp] [Enact_Settings] Y26 TV Planned.Q.Issue' },
  { key: 'TVPLAT-805007', name: '[MS_SystemApp] [Enact_Settings] [2026] Meeting' },
  { key: 'TVPLAT-805008', name: '[MS_SystemApps] [Enact_Settings] Personal Work Log (2026)' },
];

async function seed() {
  await connectToMongo();
  const db = getMongoDb();

  const result = await db.collection('part_teams').updateOne(
    { teamId: TEAM_ID },
    { $set: { epics: EPICS } },
    { upsert: true }
  );

  if (result.upsertedCount) {
    console.log(`Created new part_teams document for teamId ${TEAM_ID} with ${EPICS.length} epics.`);
  } else {
    console.log(`Updated part_teams for teamId ${TEAM_ID}: epics set to ${EPICS.length} entries.`);
  }

  await closeMongo();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
