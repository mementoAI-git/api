import {model, Schema, PaginateModel} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IActivity {
  user: string;
  title: string;
  description: string;
  type: string;
  action:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'viewed'
    | 'bookmarked'
    | 'unbookmarked'
    | 'responded'
    | 'shared'
    | 'restored';
  reference?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

const activity = new Schema<IActivity>(
  {
    user: {
      type: String,
      ref: 'user',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['memory', 'prompt', 'beneficiary', 'user', 'feedback'],
    },
    action: {
      type: String,
      required: true,
    },
    reference: String,
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

activity.plugin(mongoosePaginate);

const Activity = model<IActivity, PaginateModel<IActivity>>(
  'activity',
  activity,
);
export default Activity;
