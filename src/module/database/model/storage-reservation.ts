import {model, Schema} from 'mongoose';

export type StorageReservationStatus =
  | 'reserved'
  | 'committed'
  | 'released'
  | 'expired';

export interface IStorageReservation {
  reservation_id: string;
  user_id: string;
  requested_bytes: number;
  request_fingerprint?: string;
  committed_bytes?: number;
  file_ids?: string[];
  limit_bytes: number;
  status: StorageReservationStatus;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

const storageReservationSchema = new Schema<IStorageReservation>(
  {
    reservation_id: {type: String, required: true, unique: true, index: true},
    user_id: {type: String, required: true, index: true},
    requested_bytes: {type: Number, required: true, min: 0},
    request_fingerprint: {type: String, default: null},
    committed_bytes: {type: Number, min: 0},
    file_ids: [{type: String, ref: 'file'}],
    limit_bytes: {type: Number, required: true, min: 0},
    status: {
      type: String,
      enum: ['reserved', 'committed', 'released', 'expired'],
      default: 'reserved',
      required: true,
      index: true,
    },
    expires_at: {type: Date, required: true, index: true},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

storageReservationSchema.index({user_id: 1, status: 1, expires_at: 1});

const StorageReservation = model<IStorageReservation>(
  'storage_reservation',
  storageReservationSchema,
);
export default StorageReservation;
