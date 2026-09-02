import type {PushPlatform} from '../../database/model/push-device';

export interface IRegisterPushDevice {
  platform: PushPlatform;
  push_token: string;
}

export interface PushDeviceDto {
  installation_id: string;
  platform: PushPlatform;
  enabled: boolean;
  last_seen_at: Date;
}
