import {model, Schema} from 'mongoose';
const schema = new Schema({
  _id: {type: String, required: true},
  viewer_id: {type: String, required: true},
  owner_id: {type: String, required: true},
  shared_space: {type: Boolean, default: false},
  share_inputs: {type: Boolean, default: false},
  base_revision: {type: String, required: true},
  context_versions: {type: Map, of: String, default: {}},
  expires_at: {type: Date, required: true, index: {expires: 0}},
});
export default model('people_voice_session', schema);
