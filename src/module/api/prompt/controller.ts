import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getFiles, responsHandler, validateRequest, getPagination } from "../../../utils/helpers"
import * as service from "./service"
import { IRequest } from "../../../utils/interface";
import redis from "../../../services/redis"

export async function getPrompts(req: IRequest, res: Response, next: NextFunction) {
  try {
    const key = `activeprompt:${req.auth.id}`

    const cachedData = await redis.get(key)
    if (cachedData) {
      const { message, data } = JSON.parse(String(cachedData))
      return responsHandler(res, StatusCodes.OK, message, data)
    }
    const { message, data } = await service.getPrompts(req.auth.id)
    await redis.set(key, JSON.stringify({ message, data }))

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getUserPrompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getUserPromptResponse(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function replyPrompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const files = getFiles(req)
    const { message, data } = await service.replyPrompt(req.body, req.auth.id, files)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getSuggestions(req: IRequest, res: Response, next: NextFunction) {
  try {
    const pagination = getPagination(req)
    const { message, data } = await service.getSuggestions(pagination)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getPromptDetails(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getPromptDetails(req.params.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getPromptsByCategory(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getPromptsByCategory(
      req.params.id,
      req.auth.id,
      getPagination(req)
    )
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getOverviewPrompts(req: IRequest, res: Response, next: NextFunction) {
  try {
    const pagination = getPagination(req)
    const { message, data } = await service.getOverviewPrompts(req.auth.id, pagination)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}
