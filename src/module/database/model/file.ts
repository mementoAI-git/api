import { model, Schema } from 'mongoose';
import { BACKEND_URL } from '../../../utils/config';

export interface ITranscriptionSegment {
  start: number; // start time in seconds
  end: number;   // end time in seconds
  text: string;  // transcript text for this segment
}

export interface ITranscriptionData {
  full_text: string;
  segments: ITranscriptionSegment[];
}

export interface IFile {
  type: string
  size: string // bytes
  name: string
  url: string
  user: string
  base64: string
  transcription: ITranscriptionData // support both old string format and new structured format
  created_at: string
  updated_at: string
}

const transcriptionSegmentSchema = new Schema({
  start: { type: Number, required: true },
  end: { type: Number, required: true },
  text: { type: String, required: true }
}, { _id: false });

const transcriptionDataSchema = new Schema({
  full_text: { type: String, required: true },
  segments: [transcriptionSegmentSchema]
}, { _id: false });

const file = new Schema<IFile>({
  type: String,
  size: String,
  name: {
    type: String,
    unique: true
  },
  user: String,
  base64: String,
  transcription: transcriptionDataSchema
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