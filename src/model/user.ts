import dayjs from 'dayjs';
import { model, Schema } from 'mongoose';
import { BACKEND_URL } from '../utils/config';
import { isEmpty } from '../utils/helpers';

export interface IUser {
  email: string
  first_name: string
  last_name: string
  gender: string
  phone_number: string
  dob: string
  country: string
  password: string
  onbaorded: boolean
  providers: string[]
  verified: boolean
  private_key: string
  public_key: string
  two_factor: {
    secret: string
    enabled: boolean
  }
  picture: string
  picture_url?: string
  last_seen: string
  streak: number
  fullname?: string | null
  newsletter_subscriber: boolean
  created_at: string
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
  two_factor: {
    secret: {
      type: String,
      default: null
    },
    enabled: {
      type: Boolean,
      default: false
    }
  },
  providers: [String],
  phone_number: String,
  onbaorded: {
    type: Boolean,
    default: false,
  },
  verified: {
    type: Boolean,
    default: false
  },
  newsletter_subscriber: {
    type: Boolean,
    default: false
  },
  picture: String,
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
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

user.virtual('picture_url').get(function () {
  return `${BACKEND_URL}/files/${this.picture}`;
});
user.virtual('fullname').get(function () {
  return (isEmpty(this.first_name) && isEmpty(this.last_name)) ? null : `${this.first_name || ""} ${this.last_name || ""}`;
});

const User = model<IUser>('user', user);
export default User;
