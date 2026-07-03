import {model, Schema} from 'mongoose';
import {IPrompt} from './prompt';

interface IActivePrompt {
  prompt: string | IPrompt;
  memory: string;
  user: string;
  /** Calendar day (YYYY-MM-DD) in the user's timezone — from client `date_key`. */
  day_key?: string;
  created_at: string;
  updated_at: string;
}

const activePrompt = new Schema<IActivePrompt>(
  {
    prompt: {
      type: String,
      ref: 'prompt',
      index: true,
    },
    memory: String,
    user: {
      type: String,
      ref: 'user',
      index: true,
    },
    day_key: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

activePrompt.index({user: 1, day_key: 1});

const ActivePrompt = model<IActivePrompt>('activeprompt', activePrompt);
export default ActivePrompt;
