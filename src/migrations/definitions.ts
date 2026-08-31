import type {mongo} from 'mongoose';
import type {DatabaseMigration} from './index';

type Db = mongo.Db;
type ObjectId = mongo.ObjectId;

interface BookmarkDuplicate {
  _id: {memory: string; user: string};
  bookmark_ids: ObjectId[];
}

async function deduplicateBookmarks(db: Db): Promise<void> {
  const bookmarks = db.collection('bookmarks');
  const duplicates = await bookmarks
    .aggregate<BookmarkDuplicate>([
      {$sort: {created_at: 1, _id: 1}},
      {
        $group: {
          _id: {memory: '$memory', user: '$user'},
          bookmark_ids: {$push: '$_id'},
        },
      },
      {$match: {'bookmark_ids.1': {$exists: true}}},
    ])
    .toArray();

  await Promise.all(
    duplicates.map(({bookmark_ids}) =>
      bookmarks.deleteMany({_id: {$in: bookmark_ids.slice(1)}}),
    ),
  );
}

export const MIGRATIONS: readonly DatabaseMigration[] = [
  {
    id: '202608300001_bookmark_dedupe_and_core_query_indexes',
    up: async db => {
      await deduplicateBookmarks(db);

      await Promise.all([
        db
          .collection('bookmarks')
          .createIndex(
            {user: 1, memory: 1},
            {name: 'bookmark_user_memory_lookup'},
          ),
        db
          .collection('memories')
          .createIndex(
            {user: 1, type: 1, created_at: -1},
            {name: 'memory_user_type_created_at_desc'},
          ),
        db
          .collection('messages')
          .createIndex(
            {user: 1, memory: 1, created_at: -1},
            {name: 'message_user_memory_created_at_desc'},
          ),
        db
          .collection('activities')
          .createIndex(
            {user: 1, created_at: -1},
            {name: 'activity_user_created_at_desc'},
          ),
        db.collection('ai_metrics').createIndex(
          {
            event: 1,
            'metadata.client': 1,
            'metadata.version': 1,
            created_at: -1,
          },
          {name: 'metric_event_client_version_created_at_desc'},
        ),
      ]);
    },
  },
];
