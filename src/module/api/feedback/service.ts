import {InternalServerErrorException} from '../../../utils/service-error';
import Feedback, {IFeedback} from '../../database/model/feedback';
import mail from '../../mail';
import {track} from '../activity/service';
import {getProfile} from '../user/service';

export async function createFeedback(payload: IFeedback, user_id: string) {
  console.log(payload, 'PAYLOAD');
  const {type, email, message, screenshotUrl} = payload;
  const user = getProfile(user_id);

  const feedback = await Feedback.create({
    type,
    email,
    message,
    screenshotUrl,
    user_id,
  });

  if (!feedback) {
    throw new InternalServerErrorException('Unable to save feedback');
  }

  // await mail.sendBeneficiaryInvite(data)
  await mail.sendFeedbackConfirmation({
    email: email,
    name: user?.name,
    type,
    message,
  });

  // await mail.notifyTeamFeedback({
  //   type,
  //   message,
  //   email: email,
  //   userName: user?.name,
  //   screenshotId: screenshotUrl,
  //   feedbackId: feedback._id.toString(),
  // });

  await track(
    {
      title: 'Feedback Created',
      description: `Created Feedback: "${payload.type}"`,
      type: 'feedback',
      action: 'created',
      reference: feedback.id,
    },
    user_id,
  );

  return {
    message: 'Feedback Sent Successfully',
    data: feedback,
  };
}
