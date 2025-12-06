import { FeedbackType } from "../database/model/feedback";

export interface INotifyTeamFeedback {
  type: FeedbackType;
  message: string;
  name: string;
  screenshot: string;
  feedbackId: string;
}