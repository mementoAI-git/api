import {model, Schema} from 'mongoose';

const schema = new Schema({
  _id: {type: String, required: true},
  used: {type: Number, required: true},
  expires_at: {type: Date, required: true},
});
schema.index({expires_at: 1}, {expireAfterSeconds: 0});

export default model('promptshuffleusage', schema);
