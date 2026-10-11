import {NextFunction, Response} from 'express';
import {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';
import * as contributions from './contributions';
import * as settings from './settings';
import * as activation from './activation';
import * as talk from './talk';

export async function list(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'People retrieved',
      await service.list(req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}

export async function space(req: IRequest, res: Response, next: NextFunction) {
  try {
    const data = await service.space(String(req.params.personId), req.auth.id, {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
      filter: String(req.query.filter),
    });
    return responsHandler(res, 200, 'Shared space retrieved', data);
  } catch (error) {
    next(error);
  }
}

export async function sources(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Memories retrieved',
      await contributions.sources(req.auth.id, {
        page: Number(req.query.page),
        limit: Number(req.query.limit),
        search: String(req.query.search),
      }),
    );
  } catch (error) {
    next(error);
  }
}
export async function contribute(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      201,
      'Added to Our Space',
      await contributions.contribute(
        String(req.params.personId),
        req.auth.id,
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function share(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'Shared in Our Space',
      await contributions.share(
        String(req.params.personId),
        req.auth.id,
        req.body.source_id,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function detail(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'Shared item retrieved',
      await contributions.detail(
        String(req.params.personId),
        req.auth.id,
        String(req.params.sourceId),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function remove(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'Removed from Our Space',
      await contributions.remove(
        String(req.params.personId),
        req.auth.id,
        String(req.params.sourceId),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function getSettings(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Connection settings',
      await settings.getSettings(String(req.params.personId), req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}
export async function label(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'Relationship updated',
      await settings.updateLabel(
        String(req.params.personId),
        req.auth.id,
        req.body.label,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function disconnect(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Connection removed',
      await settings.disconnect(
        String(req.params.personId),
        req.auth.id,
        req.body.block,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function blocked(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Blocked people',
      await settings.blocked(req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}
export async function unblock(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Connection unblocked',
      await settings.unblock(String(req.params.personId), req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}
export async function getActivation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Memento availability',
      await activation.get(req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}
export async function setActivation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Memento availability updated',
      await activation.update(req.auth.id, req.body),
    );
  } catch (error) {
    next(error);
  }
}
export async function talkHistory(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Private Talk',
      await talk.history(String(req.params.personId), req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}
export async function talkSend(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Memento response',
      await talk.send(String(req.params.personId), req.auth.id, req.body),
    );
  } catch (error) {
    next(error);
  }
}
