import {model, Schema} from 'mongoose';
const schema = new Schema(
  {
    token_hash: {type: String, required: true, unique: true},
    staff_id: {type: Schema.Types.ObjectId, required: true, index: true},
    credential_version: {type: Number, required: true},
    expires_at: {type: Date, required: true, expires: 0},
  },
  {timestamps: true},
);
export default model('staff_session', schema);
