import {model, Schema} from 'mongoose';
export const SHARED_ITEM_TYPES = [
  'story',
  'note',
  'photo',
  'video',
  'voice',
] as const;
export interface ISharedItem {
  _id: string;
  shared_space_id: string;
  source_id: string;
  contributor_user_id: string;
  kind: (typeof SHARED_ITEM_TYPES)[number];
  shared_via: 'direct' | 'share_from_memento';
  shared_at: Date;
  removed_at: Date | null;
}
// Metadata describes a source. Current source permissions always decide access.
const schema = new Schema<ISharedItem>({
  _id: {type: String, required: true},
  shared_space_id: {type: String, required: true, index: true},
  source_id: {type: String, required: true, index: true},
  contributor_user_id: {type: String, required: true},
  kind: {type: String, enum: SHARED_ITEM_TYPES, required: true},
  shared_via: {
    type: String,
    enum: ['direct', 'share_from_memento'],
    required: true,
  },
  shared_at: {type: Date, required: true},
  removed_at: {type: Date, default: null},
});
export default model<ISharedItem>('shared_item', schema);
