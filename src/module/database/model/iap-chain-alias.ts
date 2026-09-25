import {model, Schema} from 'mongoose';
import type {StoreProvider} from './iap-subscription-chain';

export interface IIapChainAlias {
  provider: StoreProvider;
  alias_key: string;
  chain_id: string;
  user_id: string;
  created_at?: Date;
}

const schema = new Schema<IIapChainAlias>(
  {
    provider: {type: String, required: true, enum: ['apple', 'google']},
    alias_key: {type: String, required: true},
    chain_id: {type: String, required: true, index: true},
    user_id: {type: String, required: true, index: true},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: false}},
);

schema.index({provider: 1, alias_key: 1}, {unique: true});

const IapChainAlias = model<IIapChainAlias>('iap_chain_alias', schema);
export default IapChainAlias;
