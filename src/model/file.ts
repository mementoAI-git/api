import { model, Schema } from 'mongoose';

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
  url: String,
  user: String,
  base64: String,
  transcription: String
})

const File = model("file", file)
export default File