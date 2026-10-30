import {model, Schema} from 'mongoose';

// Content-free delivery receipts are retained to join signups and deduplicate resends.
const schema = new Schema({
  _id: {type: String, required: true},
  inviter_id: {type: String, required: true},
  invitee_key: {type: String, required: true, index: true},
  beneficiary_id: {type: String, required: true},
  existing_user: {type: Boolean, required: true},
  sent_at: {type: Date, required: true},
});
export default model('growth_invitation', schema);
