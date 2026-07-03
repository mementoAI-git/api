import {model, Schema} from 'mongoose';

export interface IDailyAiPromptCache {
  user: string;
  date_key: string;
  prompt_text: string;
  generated_at: Date;
  expires_at: Date;
}

const dailyAiPromptCacheSchema = new Schema<IDailyAiPromptCache>(
  {
    user: {
      type: String,
      ref: 'user',
      required: true,
      index: true,
    },
    date_key: {
      type: String,
      required: true,
    },
    prompt_text: {
      type: String,
      required: true,
    },
    generated_at: {
      type: Date,
      default: Date.now,
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  {timestamps: false},
);

dailyAiPromptCacheSchema.index({user: 1, date_key: 1}, {unique: true});
dailyAiPromptCacheSchema.index({expires_at: 1}, {expireAfterSeconds: 0});

const DailyAiPromptCache = model<IDailyAiPromptCache>(
  'dailyaipromptcache',
  dailyAiPromptCacheSchema,
);

export default DailyAiPromptCache;
