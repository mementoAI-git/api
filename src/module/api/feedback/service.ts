import { BadRequestException } from '../../../utils/service-error';
import Feedback, { IFeedback } from '../../database/model/feedback';
import mail from '../../mail';
import { getProfile } from '../user/service';
import File from '../../database/model/file';

export async function createFeedback(payload: IFeedback, user_id: string) {
  const { type, email, message, screenshot: screenshotId } = payload;
  const { data: user } = await getProfile(user_id);

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

  const mailPayload = {
    name: user?.fullname ?? undefined,
    type,
    message,
    screenshot: "",
    feedbackId: "",
  };

  mail.sendFeedbackConfirmation({ ...mailPayload, email });

  if (screenshotId) {
    const file = await File.findById(screenshotId);
    if (file) {
      mailPayload.screenshot = file.url;
    }
  }

  mailPayload.feedbackId = feedback.id;
  mail.notifyTeamFeedback(mailPayload);

  return {
    message: 'Feedback Sent Successfully',
    data: feedback,
  };
}
