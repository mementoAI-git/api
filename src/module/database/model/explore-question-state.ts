import mongoose, {model, Model, Schema} from 'mongoose';

export const EXPLORE_QUESTION_STATUSES = ['skipped', 'not-relevant'] as const;

export type ExploreQuestionStatus = (typeof EXPLORE_QUESTION_STATUSES)[number];

export interface IExploreQuestionState {
  user: string;
  prompt: string;
  status: ExploreQuestionStatus;
  created_at: Date;
  updated_at: Date;
}

const exploreQuestionState = new Schema<IExploreQuestionState>(
  {
    user: {
      type: String,
      ref: 'user',
      required: true,
    },
    prompt: {
      type: String,
      ref: 'prompt',
      required: true,
    },
    status: {
      type: String,
      enum: EXPLORE_QUESTION_STATUSES,
      required: true,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

exploreQuestionState.index({user: 1, prompt: 1}, {unique: true});
exploreQuestionState.index({user: 1, status: 1});

const ExploreQuestionState =
  (mongoose.models.explorequestionstate as
    | Model<IExploreQuestionState>
    | undefined) ||
  model<IExploreQuestionState>('explorequestionstate', exploreQuestionState);

export default ExploreQuestionState;
