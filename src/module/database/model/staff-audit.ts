import {model, Schema} from 'mongoose';
const schema = new Schema(
  {
    staff_id: {type: String, required: true, index: true},
    action: {type: String, required: true},
    actor: {type: String, required: true},
  },
  {timestamps: true},
);
export default model('staff_audit', schema);
