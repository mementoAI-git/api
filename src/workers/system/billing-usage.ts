import {reconcileAllBillingUsage} from '../../module/api/billing/reconciliation';
import {releaseExpiredStorageReservations} from '../../module/api/billing/storage-quota';
import logger from '../../utils/logger';

export async function expireStorageReservations(): Promise<void> {
  const released = await releaseExpiredStorageReservations();
  logger.info({released}, 'Expired stale storage reservations');
}

export async function reconcileBillingUsage(): Promise<void> {
  const processed = await reconcileAllBillingUsage();
  logger.info({processed}, 'Reconciled billing usage counters');
}
