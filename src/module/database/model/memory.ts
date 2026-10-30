import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import {IFile} from './file';

export interface IMemorySearchIndex {
  fingerprint: string;
  version: string;
  retry_after?: Date;
  chunks: {kind: 'story' | 'photo'; vector: number[]; file_id?: string}[];
}

export interface IMemory {
  _id?: string;
  title: string;
  body: string;
  type: string; // story conversation
  user: string;
  attachments: (string | IFile)[];
  tags: string[];
  level: number;
  refrence: string;
  status: string | 'draft' | 'save' | 'queued' | 'on_chain' | 'deleted';
  deleted_at?: Date;
  delete_after?: Date;
  previous_status?: string;
  purge_requested_at?: Date;
  purge_processing_at?: Date;
  prompt?: string;
  /** AI daily prompt text when there is no Prompt catalog document */
  prompt_text?: string;
  prompt_type?: 'static' | 'ai-generated';
  /** YYYY-MM-DD (user local) for daily reflection + chat context */
  reflection_day_key?: string;
  session_id?: string;
  last_opened: string;
  created_at: string;
  updated_at?: string;
  groups?: string[];
  beneficiaries?: string[];
  // AI context optimization fields
  summary?: string; // AI-generated conversation summary
  topics?: string[]; // Key topics discussed in this conversation
  last_summarized_at?: Date; // Track when the conversation was last summarized
  message_count?: number; // Track message count for summarization triggers
  last_active?: Date; // Track last activity for inactivity-based summarization
  dimensions?: string[]; // Dimensions discussed in this conversation
  /** Deliberate vs Quick Capture flow */
  capture_source?: 'standard' | 'quick';
  /** AI enrichment for Quick Capture (title/tags/category) */
  enrichment_status?: 'pending' | 'complete' | 'failed';
  /** Display / enrichment category (e.g. life dimension label) */
  category?: string;
  /** Who can discover the story; default private. `everyone` must be sent explicitly. */
  visibility?: 'private' | 'everyone';
  /** Private derived search data; never part of API serialization. */
  search_index?: IMemorySearchIndex;
}

const memory = new Schema<IMemory>(
  {
    title: String,
    body: String,
    user: String,
    type: {
      type: String,
      default: 'story',
    },
    status: {
      type: String,
      default: 'draft',
    },
    deleted_at: Date,
    delete_after: Date,
    previous_status: String,
    purge_requested_at: Date,
    purge_processing_at: Date,
    attachments: [
      {
        type: String,
        ref: 'file',
      },
    ],
    tags: [String],
    level: {
      type: Number,
      default: 1,
    },
    groups: [
      {
        type: String,
        ref: 'group',
      },
    ],
    beneficiaries: [
      {
        type: String,
        ref: 'beneficiary',
      },
    ],
    refrence: String,
    prompt: String,
    prompt_text: String,
    prompt_type: {
      type: String,
      enum: ['static', 'ai-generated'],
    },
    reflection_day_key: String,
    session_id: String,
    last_opened: Date,
    summary: {
      type: String,
      default: null,
    },
    topics: [String],
    last_summarized_at: {
      type: Date,
      default: null,
    },
    message_count: {
      type: Number,
      default: 0,
    },
    last_active: {
      type: Date,
      default: null,
    },
    dimensions: [String],
    capture_source: {
      type: String,
      enum: ['standard', 'quick'],
      default: 'standard',
    },
    enrichment_status: {
      type: String,
      enum: ['pending', 'complete', 'failed'],
    },
    category: {
      type: String,
      default: null,
    },
    visibility: {
      type: String,
      enum: ['private', 'everyone'],
      default: 'private',
    },
    search_index: {
      type: new Schema<IMemorySearchIndex>(
        {
          fingerprint: {type: String, required: true},
          version: {type: String, required: true},
          retry_after: Date,
          chunks: [
            {
              _id: false,
              kind: {type: String, enum: ['story', 'photo']},
              vector: [Number],
              file_id: String,
            },
          ],
        },
        {_id: false},
      ),
      select: false,
      default: undefined,
    },
  },
  {
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.search_index;
        delete ret.previous_status;
        delete ret.purge_requested_at;
        delete ret.purge_processing_at;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        delete ret.search_index;
        delete ret.previous_status;
        delete ret.purge_requested_at;
        delete ret.purge_processing_at;
        return ret;
      },
    },
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

memory.index({status: 1, delete_after: 1});
memory.plugin(mongoosePaginate);

const Memory = model<IMemory, PaginateModel<IMemory>>('memory', memory);
export default Memory;
