import {model, Schema} from 'mongoose';

interface ISharedSpace {
  _id: string;
  user_a: string;
  user_b: string;
  created_at: Date;
}

// The sorted pair is the primary key, so concurrent resolution cannot create
// two spaces, even before secondary indexes have been built.
const schema = new Schema<ISharedSpace>(
  {
    _id: {type: String, required: true},
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
