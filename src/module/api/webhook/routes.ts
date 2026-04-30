import {Router, type IRouter} from 'express';
import express from 'express';
import * as ctrl from './controller';

const router: IRouter = Router();

router.post('/tally', ctrl.handleTally);
router.post(
  '/payments',
  express.raw({type: 'application/json'}),
  ctrl.handlePayments,
);

export const name = 'webhooks';
export default router;
