import {Document, model, Schema} from 'mongoose';

export interface IBookmark extends Document {
  user: string;
  memory: string;
  created_at: Date;
  updated_at: Date;
}

const bookmark = new Schema(
  {
    user: {
      type: String,
      ref: 'user',
      required: true,
      index: true,
    },
    memory: {
      type: String,
      ref: 'memory',
      required: true,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

const Bookmark = model<IBookmark>('bookmark', bookmark);
export default Bookmark;
