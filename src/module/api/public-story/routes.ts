import {NextFunction, Request, Response, Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {FRONTEND_URL} from '../../../utils/config';
import {
  InternalServerErrorException,
  NotFoundException,
} from '../../../utils/service-error';
import {getPublicMemory} from '../memory/service';
import {renderPublicStory, STORY_CSP} from './view';

/** GET /public/stories/:id: a shared story's link preview page (see view.ts). */
async function view(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '');
    if (!/^[0-9a-fA-F]{24}$/.test(id))
      throw new NotFoundException('Story not found');
    if (!FRONTEND_URL) {
      throw new InternalServerErrorException('Story sharing is not configured');
    }
    const {data} = await getPublicMemory(id);
    res.setHeader('Content-Security-Policy', STORY_CSP);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.type('html').send(
      renderPublicStory(
        {
          id,
          title: data.title,
          body: data.body,
          attachments: data.attachments as never,
        },
        FRONTEND_URL,
      ),
    );
  } catch (error) {
    return next(error);
  }
}

const router = Router();
router.get('/:id', rateLimit({windowMs: 60000, limit: 120}), view);
export default router;
