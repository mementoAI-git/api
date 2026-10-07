import type {mongo} from 'mongoose';
import type {DatabaseMigration} from './index';
import {createHash, randomUUID} from 'crypto';
import {runExploreTopicsMigration} from '../module/database/migrations/explore-topics-v2';
import {seedExploreStarterQuestions} from '../module/database/seed/explore-prompts.seed';

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
        db
          .collection('archive_exports')
          .createIndex(
            {user_id: 1, created_at: -1},
            {name: 'archive_export_user_created_desc'},
          ),
        db
          .collection('archive_exports')
          .createIndex({expires_at: 1}, {name: 'archive_export_expiry'}),
      ]);
    },
  },
  {
    id: '202609240001_store_billing_identity_and_ownership_indexes',
    up: async db => {
      const subscriptions = db.collection('subscriptions');
      const cursor = subscriptions.find({
        $or: [
          {store_account_token: {$exists: false}},
          {store_account_token: null},
          {store_account_token: ''},
        ],
      });
      for await (const subscription of cursor) {
        await subscriptions.updateOne(
          {_id: subscription._id},
          {$set: {store_account_token: randomUUID()}},
        );
      }

      const transactions = db.collection('iap_transactions');
      const ownershipConflicts = await transactions
        .aggregate([
          {
            $group: {
              _id: {
                provider: '$provider',
                original_transaction_id: '$original_transaction_id',
              },
              users: {$addToSet: {$toString: '$user_id'}},
            },
          },
          {$match: {'users.1': {$exists: true}}},
          {$limit: 1},
        ])
        .toArray();
      if (ownershipConflicts.length > 0) {
        throw new Error(
          'IAP subscription-chain ownership conflict requires manual resolution',
        );
      }
      const transactionCursor = transactions.find({});
      for await (const transaction of transactionCursor) {
        const transactionId = String(transaction.transaction_id || '');
        const originalId = String(
          transaction.original_transaction_id || transactionId,
        );
        if (!transactionId || !originalId || !transaction.provider) continue;
        const transactionKey = createHash('sha256')
          .update(`${transaction.provider}:${transactionId}`)
          .digest('hex');
        const aliasKey = createHash('sha256')
          .update(`${transaction.provider}:${originalId}`)
          .digest('hex');
        const chainId = transaction.chain_id || randomUUID();
        await transactions.updateOne(
          {_id: transaction._id},
          {
            $set: {
              transaction_id: transactionKey,
              transaction_key: transactionKey,
              original_transaction_id: aliasKey,
              chain_id: chainId,
            },
          },
        );
        await db.collection('iap_chain_aliases').updateOne(
          {provider: transaction.provider, alias_key: aliasKey},
          {
            $setOnInsert: {
              provider: transaction.provider,
              alias_key: aliasKey,
              chain_id: chainId,
              user_id: String(transaction.user_id),
              created_at: new Date(),
            },
          },
          {upsert: true},
        );
      }

      await Promise.all([
        subscriptions.createIndex(
          {store_account_token: 1},
          {name: 'subscription_store_account_token_unique', unique: true},
        ),
        db
          .collection('iap_subscription_chains')
          .createIndex(
            {chain_id: 1},
            {name: 'iap_chain_id_unique', unique: true},
          ),
        db
          .collection('iap_subscription_chains')
          .createIndex(
            {provider: 1, user_id: 1},
            {name: 'iap_chain_provider_user'},
          ),
        db
          .collection('iap_chain_aliases')
          .createIndex(
            {provider: 1, alias_key: 1},
            {name: 'iap_chain_alias_unique', unique: true},
          ),
        transactions.createIndex(
          {provider: 1, transaction_key: 1},
          {name: 'iap_transaction_provider_key_unique', unique: true},
        ),
        db
          .collection('store_notification_events')
          .createIndex(
            {provider: 1, event_id: 1},
            {name: 'store_notification_provider_event_unique', unique: true},
          ),
        db
          .collection('store_notification_events')
          .createIndex(
            {status: 1, received_at: 1},
            {name: 'store_notification_status_received'},
          ),
      ]);
    },
  },
  {
    id: '202610030001_explore_topics_starters_and_compatibility',
    up: async () => {
      await runExploreTopicsMigration({apply: true, reverse: false});
      await seedExploreStarterQuestions();
    },
  },
  {
    id: '202610070001_personal_referral_links',
    up: async db => {
      await db
        .collection('users')
        .createIndex(
          {referral_code: 1},
          {unique: true, sparse: true, name: 'referral_code_1'},
        );
      await db
        .collection('users')
        .createIndex({referred_by: 1}, {name: 'referred_by_1'});
    },
  },
];
