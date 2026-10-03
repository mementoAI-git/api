import Prompt from './model/prompt';
import ExploreQuestionState from './model/explore-question-state';

export async function ensureExploreIndexes() {
  await Promise.all([
    Prompt.collection.createIndex(
      {stable_id: 1},
      {unique: true, sparse: true, name: 'stable_id_1'},
    ),
    Prompt.collection.createIndex(
      {category: 1, source: 1, active: 1},
      {name: 'category_1_source_1_active_1'},
    ),
    Prompt.collection.createIndex(
      {owner_user: 1, category: 1, source: 1},
      {name: 'owner_user_1_category_1_source_1'},
    ),
    ExploreQuestionState.collection.createIndex(
      {user: 1, prompt: 1},
      {unique: true, name: 'user_1_prompt_1'},
    ),
    ExploreQuestionState.collection.createIndex(
      {user: 1, status: 1},
      {name: 'user_1_status_1'},
    ),
  ]);
}
