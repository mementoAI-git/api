import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import * as ctrl from './controller';
import {
  checkoutSchema,
  iapVerifySchema,
  portalSchema,
  promoRedeemSchema,
  cancelSubscriptionSchema,
} from './dto';

const router: IRouter = Router();

router.get('/subscription', gaurd, ctrl.getSubscription);
router.get('/usage', gaurd, ctrl.getUsage);
router.post('/checkout', gaurd, validate(checkoutSchema), ctrl.checkout);
router.post('/portal', gaurd, validate(portalSchema), ctrl.portal);
router.post(
  '/promo/redeem',
  gaurd,
  validate(promoRedeemSchema),
  ctrl.promoRedeem,
);
router.post('/iap/verify', gaurd, validate(iapVerifySchema), ctrl.verifyIap);
router.get('/invoices', gaurd, ctrl.invoices);
router.post('/cancel', gaurd, validate(cancelSubscriptionSchema), ctrl.cancel);
router.post('/resume', gaurd, ctrl.resume);

export const name = 'billing';
export default router;
