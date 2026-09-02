import PushDevice from '../module/database/model/push-device';
import logger from '../utils/logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendCapsuleReadyPush(
  userId: string,
  capsuleId: string,
): Promise<void> {
  const devices = await PushDevice.find({user_id: userId, enabled: true})
    .select('+push_token')
    .lean();
  if (!devices.length) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(
        devices.map(device => ({
          to: device.push_token,
          title: 'A time capsule is ready',
          body: 'Open Memento to see what was saved for you.',
          data: {type: 'capsule_received', capsule_id: capsuleId},
          sound: 'default',
        })),
      ),
    });
    if (!response.ok) {
      logger.warn(
        {userId, capsuleId, status: response.status},
        'Capsule push notification was not accepted',
      );
    }
  } catch (error) {
    logger.warn(
      {
        userId,
        capsuleId,
        errorCode: error instanceof Error ? error.name : 'push_failed',
      },
      'Capsule push notification failed',
    );
  }
}
