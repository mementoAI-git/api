import { NextFunction, Request, Response } from "express";
import * as service from "./service"
import { responsHandler, validateRequest } from "../../../utils/helpers";
import { StatusCodes } from "http-status-codes";
import { IRequest } from "../../../utils/interface";
import { UnauthorizedException } from "../../../utils/service-error";

export function generateOauthUrl(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = service.generateOauthUrl(String(req.params.provider))
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function authorization(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.oauthAuthorization(req.body, String(req.params.provider))
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.login(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.register(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function sendLink(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.sendLink(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.verifyEmail(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.setPassword(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.refreshToken(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function logout(req: IRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.auth?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const { message, data } = await service.logout(userId)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function sendInviteCode(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.sendInviteCode(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function verify2FALogin(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.verify2FALogin(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function beginPasskeyRegistration(req: IRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.auth?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    const { message, data } = await service.beginPasskeyRegistration(userId)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function completePasskeyRegistration(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const userId = req.auth?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    const { message, data } = await service.completePasskeyRegistration(userId, req.body)
    return responsHandler(res, StatusCodes.CREATED, message, data)
  } catch (error) {
    next(error)
  }
}

export async function beginPasskeyLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.beginPasskeyLogin(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function completePasskeyLogin(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.completePasskeyLogin(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}