import {model, Schema} from 'mongoose';

export interface IPublicProfile {
  user: string;
  token: string;
  display_name: string;
  bio: string;
  picture_url: string | null;
}

const schema = new Schema<IPublicProfile>(
  {
    user: {type: String, ref: 'user', required: true, unique: true},
    token: {type: String, required: true, unique: true},
    display_name: {type: String, required: true},
    bio: {type: String, default: ''},
    picture_url: {type: String, default: null},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

export default model<IPublicProfile>('public_profile', schema);
