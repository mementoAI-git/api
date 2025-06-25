import { model, Schema } from 'mongoose';
import { BACKEND_URL } from '../../../utils/config';

export interface IFile {
  type: string
  size: string // bytes
  name: string
  url: string
  user: string
  base64: string
  transcription: string
  created_at: string
  updated_at: string
}

const file = new Schema<IFile>({
  type: String,
  size: String,
  name: {
    type: String,
    unique: true
  },
  user: String,
  base64: String,
  transcription: String
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

file.virtual('url').get(function () {
  return `${BACKEND_URL}/files/${this.name}`;
});

const File = model("file", file)
export default File