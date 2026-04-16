import {model, Model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import {BACKEND_URL, CLOUDINARY_CLOUD_NAME} from '../../../utils/config';
import {
  DEFAULT_STORAGE_PROVIDER,
  STORAGE_PROVIDERS,
} from '../../../utils/constant';

export interface ITranscriptionSegment {
  start: number; // start time in seconds
  end: number; // end time in seconds
  text: string; // transcript text for this segment
}

export interface ITranscriptionData {
  full_text: string;
  segments: ITranscriptionSegment[];
}

export type FileStorageProvider = 's3' | 'gcs' | 'cloudinary';

export interface IFile {
  type: string;
  size: number; // bytes
  name: string;
  url: string;
  user: string;
  provider?: FileStorageProvider;
  backup_at?: Date;
  backup_url?: string;
  transcription: ITranscriptionData;
  duration?: number; // duration in seconds for audio/video files
  deleted?: boolean; // marks file as deleted so it can be cleaned up
  created_at: string;
  updated_at: string;
}

export interface IFileModel extends PaginateModel<IFile> {
  findActiveOne: Model<IFile>['findOne'];
}

const transcriptionSegmentSchema = new Schema(
  {
    start: {type: Number, required: true},
    end: {type: Number, required: true},
    text: {type: String, required: true},
  },
  {_id: false},
);

const transcriptionDataSchema = new Schema(
  {
    full_text: {type: String, required: true},
    segments: [transcriptionSegmentSchema],
  },
  {_id: false},
);

const file = new Schema<IFile>(
  {
    type: String,
    size: Number,
    name: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },
    user: String,
    provider: {
      type: String,
      enum: Object.values(STORAGE_PROVIDERS),
      default: DEFAULT_STORAGE_PROVIDER,
    },
    backup_url: {type: String},
    backup_at: {type: Date, select: false},
    transcription: transcriptionDataSchema,
    duration: Number,
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

file.virtual('url').get(function () {
  return this.backup_url; //`${BACKEND_URL}/files/${this.name}`;
});

file.plugin(mongoosePaginate);

file.statics.findActiveOne = function (
  filter = {},
  projection?: unknown,
  options?: unknown,
) {
  return this.findOne(
    {
      $and: [
        {
          deleted: {$ne: true},
          provider: {$ne: STORAGE_PROVIDERS.s3},
        },
        filter,
      ],
    },
    projection,
    options,
  );
};

const File = model<IFile, IFileModel>('file', file);
export default File;

// https://res.cloudinary.com/dnkhrtksx/video/upload/memento/5c7d4fbd-92a9-4362-ba44-dbeb5901dac6_260212101025.PNG
// https://res.cloudinary.com/dnkhrtksx/image/upload/v1772786824/memento/5c7d4fbd-92a9-4362-ba44-dbeb5901dac6_260306094331.png.png
// https://res.cloudinary.com/dnkhrtksx/image/upload/v1772743084/memento/mrs_mosun_260305203653.png.png
// https://res.cloudinary.com/dnkhrtksx/image/upload/v1771977487/memento/hbe4mlvx0aasf2l_260225005302.jpeg.jpg
// https://res.cloudinary.com/dnkhrtksx/video/upload/v1772533507/memento/ed_sheeran_proves_hard_work_pays_off_480p_260303101944.mp4.mp4
