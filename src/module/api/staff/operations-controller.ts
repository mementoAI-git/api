import type {Request, Response, NextFunction} from 'express';
import {responsHandler} from '../../../utils/helpers';
import * as service from './operations-service';
export async function accounts(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Accounts',
      await service.listAccounts(
        String(req.query.search || ''),
        Number(req.query.page || 1),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function account(req: Request, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'Account diagnostics',
      await service.accountDetail(String(req.params.id)),
    );
  } catch (error) {
    next(error);
  }
}
export async function summary(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      200,
      'Operations summary',
      await service.operationsSummary(),
    );
  } catch (error) {
    next(error);
  }
}

export async function metrics(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {collectOperationalSignals} = await import(
      '../../../services/operational-signals'
    );
    return responsHandler(
      res,
      200,
      'Operational signals',
      await collectOperationalSignals(),
    );
  } catch (error) {
    next(error);
  }
}
