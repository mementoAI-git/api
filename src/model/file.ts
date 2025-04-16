import { model, Schema } from 'mongoose';
import { BACKEND_URL } from '../utils/config';

export interface IFile {
  type: string
  name: string
  url: string
  user: string
  base64: string
  transcription: string
}

const file = new Schema<IFile>({
  type: String,
  name: {
    type: String,
    unique: true
  },
  user: String,
  base64: String,
  transcription: String
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

file.virtual('url').get(function () {
  return `${BACKEND_URL}/files/${this.name}`;
});

const File = model("file", file)
export default File