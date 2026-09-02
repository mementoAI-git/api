import {createHash} from 'crypto';
import {StatusCodes} from 'http-status-codes';
import type {MementoClient} from '../../../contracts/response';
import {ServiceError, UnprocessableContent} from '../../../utils/service-error';
import PushDevice, {
  type IPushDevice,
  type PushPlatform,
} from '../../database/model/push-device';
import type {IRegisterPushDevice, PushDeviceDto} from './interface';

function toPushDeviceDto(device: IPushDevice): PushDeviceDto {
  return {
    installation_id: device.installation_id,
    platform: device.platform,
    enabled: device.enabled,
    last_seen_at: device.last_seen_at,
  };
}

export async function register(
  userId: string,
  installationId: string,
  payload: IRegisterPushDevice,
) {
  const existingOwner = await PushDevice.findOne({
    installation_id: installationId,
    user_id: {$ne: userId},
  }).lean();
  if (existingOwner) {
    throw new ServiceError(
      'Installation is registered to another account',
      StatusCodes.CONFLICT,
    );
  }

  try {
    const device = await PushDevice.findOneAndUpdate(
      {user_id: userId, installation_id: installationId},
      {
        $set: {
          platform: payload.platform,
          push_token: payload.push_token,
          enabled: true,
          last_seen_at: new Date(),
        },
      },
      {new: true, upsert: true, setDefaultsOnInsert: true},
    );
    return {
      message: 'Push device registered successfully',
      data: toPushDeviceDto(device),
    };
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new ServiceError(
        'Installation is registered to another account',
        StatusCodes.CONFLICT,
      );
    }
    throw error;
  }
}

export async function disable(userId: string, installationId: string) {
  const device = await PushDevice.findOneAndUpdate(
    {user_id: userId, installation_id: installationId},
    {$set: {enabled: false, last_seen_at: new Date()}, $unset: {push_token: 1}},
    {new: true},
  );

  return {
    message: 'Push device disabled successfully',
    data: device ? toPushDeviceDto(device) : null,
  };
}

export function legacyInstallationId(pushToken: string): string {
  return `legacy-${createHash('sha256')
    .update(pushToken)
    .digest('hex')
    .slice(0, 24)}`;
}

export async function registerLegacyProfileToken(
  userId: string,
  pushToken: string,
  client: MementoClient,
) {
  if (client === 'legacy-unknown') {
    throw new UnprocessableContent(
      'X-Memento-Client is required to register a push token',
    );
  }
  return register(userId, legacyInstallationId(pushToken), {
    platform: client as PushPlatform,
    push_token: pushToken,
  });
}
