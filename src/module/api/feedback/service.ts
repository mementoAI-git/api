import {BadRequestException} from '../../../utils/service-error';
import Feedback, {IFeedback} from '../../database/model/feedback';
import mail from '../../mail';
import discord from '../../../services/discord';
import {getProfile} from '../user/service';
import File from '../../database/model/file';

export async function createFeedback(payload: IFeedback, user_id: string) {
  const {type, email, message, screenshot: screenshotId} = payload;
  const {data: user} = await getProfile(user_id);

  const feedback = await Feedback.create({
    type,
    email,
    message,
    screenshot: screenshotId,
    user_id,
  });

  if (!feedback) {
    throw new BadRequestException('Unable to save feedback');
  }

  const notifyPayload = {
    name: user?.fullname ?? 'Anonymous',
    email: email ?? '',
    type,
    message,
    screenshot: '',
    feedbackId: feedback.id,
  };

  if (screenshotId) {
    const file = await File.findById(screenshotId);
    if (file) {
      notifyPayload.screenshot = file.url;
    }
  }

  void mail.sendFeedbackConfirmation({...notifyPayload, email});

  // Fire notifications — neither blocks the response
  void mail.notifyTeamFeedback(notifyPayload);
  void discord.notifyFeedback(notifyPayload);

  return {
    message: 'Feedback Sent Successfully',
    data: feedback,
  };
}
