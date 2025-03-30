import { model, Schema } from 'mongoose';

export interface IFile {
  type: "audio" | "image" | "video"
  name: string
  url: string
  user: string
  transcription: string
}

const file = new Schema<IFile>({
  type: String,
  name: String,
  url: String,
  user: String,
  transcription: String
})

const File = model("file", file)
export default File