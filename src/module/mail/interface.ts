import {FeedbackType} from '../database/model/feedback';

export interface INotifyTeamFeedback {
  type: FeedbackType;
  message: string;
  name: string;
  email: string;
  screenshot: string;
  feedbackId: string;
}
