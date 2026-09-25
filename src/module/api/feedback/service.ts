import {BadRequestException} from '../../../utils/service-error';
import Feedback from '../../database/model/feedback';
import mail from '../../mail';
import discord from '../../../services/discord';
import {getProfile} from '../user/service';
import File from '../../database/model/file';
import type {CreateFeedbackBody} from './validator';

export async function createFeedback(
  payload: CreateFeedbackBody,
  user_id: string,
) {
  const {
    type,
    email,
    message,
    screenshot: screenshotId,
    screenshots: rawScreenshots,
  } = payload;
  const requestedScreenshots =
    Array.isArray(rawScreenshots) && rawScreenshots.length > 0
      ? rawScreenshots
      : screenshotId
        ? [screenshotId]
        : [];
  const screenshots = [...new Set(requestedScreenshots)];
  const primaryScreenshot = screenshots[0] || screenshotId;
  const {data: user} = await getProfile(user_id);

  const screenshotFiles = screenshots.length
    ? await File.find({
        _id: {$in: screenshots},
        user: user_id,
        deleted: {$ne: true},
        type: /^image\//i,
      })
        .select('_id url')
        .lean()
    : [];

  if (screenshotFiles.length !== screenshots.length) {
    throw new BadRequestException('One or more screenshots are unavailable.');
  }

  const feedback = await Feedback.create({
    type,
    email,
    message,
    screenshot: primaryScreenshot,
    screenshots,
    user: user_id,
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

  if (primaryScreenshot) {
    const file = screenshotFiles.find(
      item => String(item._id) === primaryScreenshot,
    );
    if (file) notifyPayload.screenshot = file.url;
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
