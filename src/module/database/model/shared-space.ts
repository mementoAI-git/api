import {model, Schema} from 'mongoose';

interface ISharedSpace {
  _id: string;
  user_a: string;
  user_b: string;
  created_at: Date;
  status: 'active' | 'removed';
  blocked_by: string[];
  labels: Record<string, string>;
  display_names: Record<string, string>;
}

// The sorted pair is the primary key, so concurrent resolution cannot create
// two spaces, even before secondary indexes have been built.
const schema = new Schema<ISharedSpace>(
  {
    _id: {type: String, required: true},
    status: {type: String, enum: ['active', 'removed'], default: 'active'},
    blocked_by: {type: [String], default: []},
    labels: {type: Map, of: String, default: {}},
    display_names: {type: Map, of: String, default: {}},
    user_a: {type: String, required: true, immutable: true},
    user_b: {type: String, required: true, immutable: true},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: false}},
);

const SharedSpace = model<ISharedSpace>('shared_space', schema);
export async function ensureSharedSpace(firstId: string, secondId: string) {
  const [user_a, user_b] = [firstId, secondId].sort();
  const id = `${user_a}:${user_b}`;
  await SharedSpace.updateOne(
    {_id: id},
    {$setOnInsert: {user_a, user_b}},
    {upsert: true},
  );
  return id;
}
export default SharedSpace;
