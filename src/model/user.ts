import dayjs from 'dayjs';
import { model, Schema } from 'mongoose';

export interface IUser {
  email: string
  first_name: string
  last_name: string
  gender: string
  phone_number: string
  dob: string
  country: string
  password: string
  providers: string[]
  verified: boolean
  private_key: string
  public_key: string
  last_seen: string
  streak: number
  newsletter_subscriber: boolean
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
  private_key: String,
  public_key: String,
  providers: [String],
  phone_number: String,
  verified: {
    type: Boolean,
    default: false
  },
  newsletter_subscriber: {
    type: Boolean,
    default: false
  },
  last_seen: {
    type: String,
    default: () => dayjs().format("YYYY-MM-DD")
  },
  streak: {
    type: Number,
    default: 1
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})

const User = model<IUser>('user', user);
export default User;
