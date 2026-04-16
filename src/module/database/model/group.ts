import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IGroup {
  id?: string;
  name: string;
  description?: string;
  user: string;
  members: string[];
  created_at: string;
  updated_at: string;
}

const group = new Schema<IGroup>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    user: {
      type: String,
      ref: 'user',
      required: true,
      index: true,
    },
    members: [
      {
        type: String,
        ref: 'beneficiary',
      },
    ],
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

group.plugin(mongoosePaginate);

const Group = model<IGroup, PaginateModel<IGroup>>('group', group);
export default Group;
