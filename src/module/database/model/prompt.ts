import mongoose, {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export type ExplorePromptSource = 'starter' | 'ai-generated' | 'legacy';

export interface ExploreGenerationContext {
  version: string;
  source_ids: string[];
  generated_at?: Date;
}

export interface IPrompt {
  _id?: string;
  title: string;
  type: string;
  category: string;
  tags: string[];
  stable_id?: string;
  source?: ExplorePromptSource;
  legacy_category?: string;
  owner_user?: string;
  active?: boolean;
  generation_context?: ExploreGenerationContext;
  created_at: string;
  updated_at: string;
}

const generationContext = new Schema<ExploreGenerationContext>(
  {
    version: String,
    source_ids: [String],
    generated_at: Date,
  },
  {_id: false},
);

const prompt = new Schema<IPrompt>(
  {
    title: String,
    type: String,
    category: String,
    tags: [String],
    stable_id: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ['starter', 'ai-generated', 'legacy'],
    },
    legacy_category: String,
    owner_user: {
      type: String,
      ref: 'user',
    },
    active: {
      type: Boolean,
      default: true,
    },
    generation_context: {
      type: generationContext,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

prompt.plugin(mongoosePaginate);
prompt.index({stable_id: 1}, {unique: true, sparse: true});
prompt.index({category: 1, source: 1, active: 1});
prompt.index({owner_user: 1, category: 1, source: 1});

const Prompt =
  (mongoose.models.prompt as unknown as PaginateModel<IPrompt> | undefined) ||
  model<IPrompt, PaginateModel<IPrompt>>('prompt', prompt);
export default Prompt;
