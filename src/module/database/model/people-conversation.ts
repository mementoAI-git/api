import {model, Schema} from 'mongoose';
export interface IPeopleConversation {
  _id: string;
  viewer_user_id: string;
  memento_owner_user_id: string;
  shared_space_id: string;
  lock?: string;
  busy_until?: Date;
}
const schema = new Schema<IPeopleConversation>(
  {
    _id: {type: String, required: true},
    viewer_user_id: {type: String, required: true, index: true},
    memento_owner_user_id: {type: String, required: true},
    shared_space_id: {type: String, required: true},
    lock: String,
    busy_until: Date,
  },
  {timestamps: true},
);
export default model<IPeopleConversation>('people_conversation', schema);
