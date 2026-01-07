import cron, { ScheduledTask } from "node-cron"
import resetStreak from "./reset-streak"
import summarizeInactiveConversations from "./summarize-inactive-conversation"
import { initializePersonaSummarization } from "../queues/summarization"

const tasks: ScheduledTask[] = []

function createTask(
  expression: string,
  handler: () => Promise<void | any>
): ScheduledTask {
  return cron.schedule(expression, handler, { scheduled: false, timezone: "UTC" })
}

export function initializeScheduler() {
  if (tasks.length > 0) return

  tasks.push(
    createTask("0 0 * * *", resetStreak),
    createTask("*/5 * * * *", summarizeInactiveConversations)
  )
  initializePersonaSummarization();

  tasks.forEach(task => task.start())
}

export function stopScheduler() {
  tasks.forEach(task => task.stop())
  tasks.length = 0
}

