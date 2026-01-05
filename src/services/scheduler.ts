import cron from "node-cron"
import { resetStreaksForInactiveUsers } from "../module/api/user/service"
import logger from "../utils/logger"

/**
 * Initialize all scheduled tasks
 */
export function initializeScheduler() {
  // Run daily at midnight (00:00) to reset streaks for inactive users
  // Cron expression: "0 0 * * *" means "at 00:00 every day"
  cron.schedule("0 0 * * *", async () => {
    try {
      logger.info("Running daily streak reset job...")
      const result = await resetStreaksForInactiveUsers()
      logger.info(`Streak reset completed: ${result.data.usersUpdated} users updated`)
    } catch (error) {
      logger.error(error, "Error running streak reset job")
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  })
}

