export interface IReplyPrompt {
  prompt_id: string;
  body: string;
  tags: string[];
  level: number;
  attachments: string[];
}

export interface IExploreQuestionFeedback {
  status: 'skipped' | 'not-relevant';
}
