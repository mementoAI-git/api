import {model, PaginateModel, Schema, Types} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

const FEEDBACK_TYPES = [
  'Bug',
  'Feature Request',
  'UI/UX Issue',
  'General Feedback',
  'Other',
] as const;

type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export interface IFeedback {
  type: FeedbackType;
  message: string;
  email?: string;
  screenshotUrl?: string;
  user?: Types.ObjectId;
  created_at: Date;
}

const feedback = new Schema<IFeedback>(
  {
    type: {
      type: String,
      required: true,
      enum: FEEDBACK_TYPES,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    email: {
      type: String,
      lowercase: true,
      sparse: true,
      trim: true,
      required: true,
    },
    screenshotUrl: String,
    user: {
      type: Schema.Types.ObjectId,
      ref: 'user',
    },
  },
  {
    timestamps: true,
    // collection: 'feedback',
  },
);

feedback.plugin(mongoosePaginate);

const Feedback = model<IFeedback, PaginateModel<IFeedback>>(
  'feedback',
  feedback,
);

export default Feedback;
