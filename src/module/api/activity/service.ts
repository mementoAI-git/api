import { IPagination } from "../../../utils/interface"
import Activity, { IActivity } from "../../database/model/activities"

export async function getUserActivities(payload: IPagination, user_id: string) {
  const { page = 1, limit = 25 } = payload

  const activities = await Activity.paginate({ user: user_id }, {
    page,
    limit,
    sort: { created_at: -1 }
  })

  return {
    data: activities,
    message: "User activities retrieved successfully"
  }
}

export async function clearUserActivities(user_id: string) {
  const result = await Activity.deleteMany({ user: user_id })

  return {
    data: { deleted_count: result.deletedCount },
    message: "All activities cleared successfully"
  }
}

export async function track(payload: Omit<IActivity, "user" | "created_at">, user_id: string) {
  try {
    await Activity.create({
      ...payload,
      user: user_id
    })
  } catch (error) {
    console.error("Failed to track activity:", error)
  }
}