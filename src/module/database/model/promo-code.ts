import {model, Schema} from 'mongoose';

export interface IPromoCode {
  code: string;
  grants_tier: 'pro' | 'legacy';
  duration_days: number;
  created_by: string;
  redeemed_by?: string | null;
  redeemed_at?: Date | null;
  expires_at: Date;
  campaign_tag?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

const promoCode = new Schema<IPromoCode>(
  {
    code: {type: String, required: true, unique: true, index: true},
    grants_tier: {type: String, enum: ['pro', 'legacy'], required: true},
    duration_days: {type: Number, required: true, min: 1},
    created_by: {type: String, required: true},
    redeemed_by: {type: String, default: null},
    redeemed_at: {type: Date, default: null},
    expires_at: {type: Date, required: true, index: true},
    campaign_tag: {type: String, default: null},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

const PromoCode = model<IPromoCode>('promo_code', promoCode);
export default PromoCode;
