import { getMongoDb } from '../utils/mongo';
import { ObjectId } from 'mongodb';
import { jiraService } from './jira.service';
import { decryptSymmetric } from '../utils/crypto';

export interface WorklogComment {
  worklogId: string;
  issueId: string;
  username: string;
  datetime: string; // ISO string or timestamp
  comment: string;
}

export async function saveWorklogComment(payload: WorklogComment) {
  const db = getMongoDb();
  const collection = db.collection('worklog_comments');

  const doc = {
    worklogId: payload.worklogId,
    issueId: payload.issueId,
    username: payload.username,
    comment: payload.comment,
    createdAt: new Date()
  };

  const res = await collection.insertOne(doc);
  return { insertedId: res.insertedId };
}

export async function getWorklogCommentsByIssue(token: string, issueId: string) {
  try {
    const worklogs = await jiraService.getWorklogsForIssue(token, issueId);
    console.log(`Fetched ${worklogs.worklogs.length} worklogs from Jira for issue ${issueId}`);
    console.log('Raw worklogs data:', worklogs.worklogs[0]);
    return worklogs.worklogs.map((w: any) => ({
      id: w.id,
      worklogId: w.id,
      issueId: issueId,
      username: w.author?.displayName || w.author?.name,
      datetime: w.started,
      comment: w.comment,
      time: w.timeSpent || (w.timeSpentSeconds ? `${(w.timeSpentSeconds/3600).toFixed(2).replace(/\.?0+$/,'')}h` : ''),
      createdAt: w.created
    }));
  } catch (error) {
    console.error('Failed to fetch worklogs from Jira:', error);
    // Fallback to MongoDB if Jira fails
    const db = getMongoDb();
    const collection = db.collection('worklog_comments');
    const cursor = collection.find({ issueId: issueId }).sort({ createdAt: -1 });
    const rows = await cursor.toArray();
    return rows.map((r: any) => ({
      id: r._id,
      worklogId: r.worklogId,
      issueId: r.issueId,
      username: r.username,
      datetime: r.datetime,
      comment: r.comment,
      time: r.time || '', // assuming time is stored
      createdAt: r.createdAt
    }));
  }
}
