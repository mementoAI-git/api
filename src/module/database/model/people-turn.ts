import {model, Schema} from 'mongoose';
export interface IPeopleTurn {
  _id: string;
  conversation_id: string;
  request_id: string;
  role: 'user' | 'ai';
  text: string;
  source_ids: string[];
  context_source_ids: string[];
  context_versions: Record<string, string>;
  base_revision: string;
  created_at: Date;
  order: number;
  is_voice: boolean;
  attachments?: string[];
  shared_input_id?: string;
}
const schema = new Schema<IPeopleTurn>({
  _id: {type: String, required: true},
  conversation_id: {type: String, required: true, index: true},
  request_id: {type: String, required: true},
  role: {type: String, enum: ['user', 'ai'], required: true},
  text: {type: String, required: true},
  source_ids: [String],
  attachments: [String],
  shared_input_id: String,
  context_source_ids: [String],
  context_versions: {type: Map, of: String},
  base_revision: String,
  created_at: {type: Date, default: Date.now},
  order: Number,
  is_voice: {type: Boolean, default: false},
});
export default model<IPeopleTurn>('people_turn', schema);
