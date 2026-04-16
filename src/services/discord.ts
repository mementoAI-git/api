import {DISCORD_FEEDBACK_WEBHOOK_URL} from '../utils/config';
import logger from '../utils/logger';
import {INotifyTeamFeedback} from '../module/mail/interface';

const TYPE_COLORS: Record<string, number> = {
  Bug: 0xed4245,
  'Feature Request': 0x5865f2,
  'UI/UX Issue': 0x9c59b6,
  'General Feedback': 0x23a559,
  Other: 0x80848e,
};

class DiscordService {
  async notifyFeedback(payload: INotifyTeamFeedback): Promise<void> {
    if (!DISCORD_FEEDBACK_WEBHOOK_URL) {
      logger.warn(
        'DISCORD_FEEDBACK_WEBHOOK_URL not set — skipping Discord notification',
      );
      return;
    }

    const {type, message, name, email, screenshot, feedbackId} = payload;
    const color = TYPE_COLORS[type] ?? 0x80848e;

    const preview =
      message.length > 500 ? message.substring(0, 497) + '...' : message;

    const body = {
      username: 'Memento',
      embeds: [
        {
          color,
          title: type,
          description: preview,
          fields: [
            {name: 'From', value: `${name}\n${email}`, inline: true},
            {name: 'Feedback ID', value: `\`${feedbackId}\``, inline: true},
            ...(screenshot
              ? [
                  {
                    name: 'Screenshot',
                    value: `[View](${screenshot})`,
                    inline: true,
                  },
                ]
              : []),
          ],
          image: screenshot ? {url: screenshot} : undefined,
          footer: {text: 'Memento Feedback'},
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      const res = await fetch(DISCORD_FEEDBACK_WEBHOOK_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        logger.error(
          `Discord webhook error ${res.status}: ${await res.text()}`,
        );
      }
    } catch (error) {
      logger.error(error, 'Failed to send Discord feedback notification');
    }
  }
}

export default new DiscordService();
