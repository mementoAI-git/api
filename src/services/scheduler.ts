import cron from "node-cron"
import { resetStreaksForInactiveUsers } from "../module/api/user/service"

/**
 * Initialize all scheduled tasks
 */
export function initializeScheduler() {
  // Run daily at midnight (00:00) to reset streaks for inactive users
  // Cron expression: "0 0 * * *" means "at 00:00 every day"
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("Running daily streak reset job...")
      const result = await resetStreaksForInactiveUsers()
      console.log(`Streak reset completed: ${result.data.usersUpdated} users updated`)
    } catch (error) {
      console.error("Error running streak reset job:", error)
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  })

  console.log("Scheduler initialized: Daily streak reset job scheduled for midnight UTC")
}

