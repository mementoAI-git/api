import {NextFunction, Response} from 'express';
import {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';
import {StatusCodes} from 'http-status-codes';

export async function listBackgroundMusic(
  _req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = service.listBackgroundMusic();
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
