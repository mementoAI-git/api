import { NextFunction, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getFiles, getPagination, responsHandler, validateRequest } from "../../../utils/helpers"
import * as service from "./service"
import { IRequest } from "../../../utils/interface";

export async function memoryStats(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.memoryStats(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function bookmark(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.bookmark(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function createMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const files = getFiles(req)
    const { message, data } = await service.createMemory(req.body, req.auth.id, files)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemories(req: IRequest, res: Response, next: NextFunction) {
  try {
    // getPagination already spreads req.query, so search/tags will be included
    const { message, data } = await service.getMemories(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getConversationMemories(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getConversationMemories(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getStoryMemories(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getStoryMemories(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemory(req.params.id, req.auth?.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemoryByPrompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemoryByPrompt(req.params.id, req.auth?.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function updateMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.updateMemory(req.params.id, req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function deleteMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)

    const payload = {
      memory_id: req.params.id,
      delete_permanently: req.body?.delete_permanently || false
    }
    const { message, data } = await service.deleteMemory(payload, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function restoreMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.restoreMemory(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function unbookmark(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.unbookmark(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function removeFileFromMemory(req: IRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    validateRequest(req)
    const { message, data } = await service.removeFileFromMemory(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function addMessageToMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.addMessageToMemory(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}