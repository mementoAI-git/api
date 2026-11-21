import {FeedbackType} from '../database/model/feedback';

export interface INotifyTeamFeedback {
  type: FeedbackType;
  message: string;
  name: string;
  email: string;
  screenshot: string;
  feedbackId: string;
}

export type SecurityEvent =
  | 'password_changed'
  | 'password_reset'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'passkey_added'
  | 'passkey_removed';
