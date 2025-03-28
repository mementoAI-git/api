import { model, Schema } from 'mongoose';

export interface IUser {
  email: string
  first_name: string
  last_name: string
  gender: string
  dob: string
  country: string
  password: string
  providers: string[]
  verified: boolean
}

const user = new Schema<IUser>({
  email: {
    type: String,
    unique: true,
    lowercase: true
  },
  first_name: String,
  last_name: String,
  gender: String,
  dob: Date,
  country: String,
  password: String,
  providers: [String],
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})

const User = model<IUser>('user', user);
export default User;
