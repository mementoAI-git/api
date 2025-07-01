import bcrypt from "bcrypt"

import { ILogin, IOAuthAuthorization, ISendLink, ISetPassword, IVerifyEmail } from "./interface";
import { OAUTH_PROVIDERS } from "../../../utils/constant";
import { compareStrings, createAccessToken, generateKeys, hashPassword, isEmpty } from "../../../utils/helpers";
import { BadRequestException, NotFoundException, UnauthorizedException } from "../../../utils/service-error";
import axios from "axios";
import dayjs from "dayjs";
import mail from "../../mail";
import User from "../../database/model/user";
import AuthCode from "../../database/model/auth-code";

export function generateOauthUrl(provider: string) {
  const { authoriation_url, redirect_uri } = OAUTH_PROVIDERS[provider || "google"]

  const params = new URLSearchParams({ response_type: "code", redirect_uri }).toString();
  const url = `${authoriation_url}&${params}`;

  return { data: { url }, message: "OAuth url generated successfully" }
}

export async function oauthAuthorization({ code }: IOAuthAuthorization, provider: string) {
  const { token_url, userinfo_url, client_id, client_secret, redirect_uri } = OAUTH_PROVIDERS[provider || "google"]

  const payload = {
    code,
    client_id,
    client_secret,
    redirect_uri,
    grant_type: "authorization_code",
  }
  const { data: result } = await axios.post(token_url, payload);

  const userinfo = await getOauthUser(userinfo_url, result.access_token, provider)
  if (!userinfo) {
    throw new UnauthorizedException()
  }

  let user = await User.findOne({ email: userinfo.email })
  if (!user) {
    const keys = generateKeys()

    user = await User.create({
      email: userinfo.email,
      first_name: userinfo.first_name,
      last_name: userinfo.last_name,
      verified: true,
      providers: [userinfo.provider],
      ...keys
    })
  }

  if (!user.providers.includes(userinfo.provider)) {
    await user.updateOne({ $addToSet: { providers: userinfo.provider } })
  }

  const data = createAccessToken(user.id)

  return { data, message: "User signin is successful" }
}

export async function login(payload: ILogin) {
  const { email, password, remember_for_30_days = false } = payload
  const user = await User.findOne({ email })
  if (!user) {
    throw new NotFoundException("User not found")
  }
  if (isEmpty(user.password)) {
    throw new NotFoundException("Please set your password")
  }

  let is_match = await bcrypt.compare(password, `${user?.password}`)
  if (!is_match) {
    throw new BadRequestException("Incorrect password")
  }
  if (!user.verified) {
    await mail.sendLink(email, user.first_name, "verify")
    throw new BadRequestException(
      "Please verify your email address",
      { requires_verification: true, email }
    )
  }
  const expires_in = remember_for_30_days ? 30 : 7
  const data = createAccessToken(user.id, expires_in * 24 * 60 * 60 * 1000)

  return { data, message: "User login is successful" }
}

export async function register(payload: ILogin) {
  const { email } = payload
  const user = await User.findOne({ email })
  if (user) {
    throw new NotFoundException("User with this emaill address aleady exist")
  }

  const password = await hashPassword(payload.password)
  const keys = generateKeys()

  await User.create({ password, email, ...keys })
  await mail.sendLink(email, "", "verify")

  const data = { requires_verification: true, email }

  return { data, message: "User registration successful" }
}

export async function sendLink(payload: ISendLink) {
  const { email, type = "reset" } = payload
  const user = await User.findOne({ email })
  if (!user) {
    throw new NotFoundException("User not found")
  }

  await mail.sendLink(email, user.first_name, type)

  return { message: `${type === "reset" ? "Reset" : "Verification"} link has been sent successfully`, data: { email } }
}

export async function verifyEmail(payload: IVerifyEmail) {
  const { token } = payload

  const authCode = await AuthCode.findOne({ code: token })
  if (!authCode) {
    throw new BadRequestException("Invalid link")
  }
  if (dayjs().isAfter(authCode.expires_at)) {
    throw new BadRequestException("Verification Link has exipred")
  }

  const user = await User.findOne({ email: authCode.email })
  if (!user) {
    throw new NotFoundException("User not found")
  }
  await user.updateOne({ verified: true })

  const { access_token, expires_at } = createAccessToken(user.id, 1 * 60 * 60 * 1000)
  const data = { access_token, expires_at, email: user.email }

  await AuthCode.deleteMany({ email: user.email })

  return { data, message: "Verification successful" }
}

export async function setPassword(payload: ISetPassword) {
  const { token } = payload

  const authCode = await AuthCode.findOne({ code: token })
  if (!authCode) {
    throw new BadRequestException("Invalid link")
  }
  if (dayjs().isAfter(authCode.expires_at)) {
    throw new BadRequestException("Reset link has exipred")
  }

  const password = await hashPassword(payload.password)

  await User.updateOne({ email: authCode.email }, { password })
  await AuthCode.deleteMany({ email: authCode.email })

  return { data: null, message: "Password reset successful" }
}

async function getOauthUser(userinfo_url: string, token: string, provider: string) {
  if (compareStrings(provider, "google")) {
    const { data } = await axios.get(
      userinfo_url,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return {
      provider: `google:${data?.id}`,
      email: data?.email,
      first_name: data?.given_name,
      last_name: data?.family_name
    }
  }
  if (compareStrings(provider, "facebook")) {
    const { data } = await axios.get(userinfo_url, { params: { access_token: token } });

    const [first_name, last_name] = data?.name.split(" ")
    return {
      provider: `facebook:${data?.id}`,
      email: data?.email,
      first_name,
      last_name
    }
  }

  if (compareStrings(provider, "apple")) {
    // TODO: Test for apple oauth jwt.decode(token)
  }
  return null
}
