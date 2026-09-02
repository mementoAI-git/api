import {model, Schema} from 'mongoose';

export type PushPlatform = 'ios' | 'android' | 'web';

export interface IPushDevice {
  user_id: string;
  installation_id: string;
  platform: PushPlatform;
  push_token: string;
  enabled: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const pushDeviceSchema = new Schema<IPushDevice>(
  {
    user_id: {type: String, required: true, index: true},
    installation_id: {type: String, required: true},
    platform: {
      type: String,
      enum: ['ios', 'android', 'web'],
      required: true,
    },
    push_token: {type: String, required: true, select: false},
    enabled: {type: Boolean, required: true, default: true},
    last_seen_at: {type: Date, required: true},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

pushDeviceSchema.index({user_id: 1, installation_id: 1}, {unique: true});
pushDeviceSchema.index({installation_id: 1}, {unique: true});
pushDeviceSchema.index({user_id: 1, enabled: 1});

const PushDevice = model<IPushDevice>('push_device', pushDeviceSchema);
export default PushDevice;
