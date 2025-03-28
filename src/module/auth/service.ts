import bcrypt from "bcrypt"

import { ILogin, IOAuthAuthorization, IVerifyCode } from "./interface";
import { OAUTH_PROVIDERS } from "../../utils/constant";
import { compareStrings, createAccessToken, hashPassword, isEmpty } from "../../utils/helpers";
import { BadRequestException, NotFoundException, UnauthorizedException } from "../../utils/service-error";
import User from "../../model/user";
import axios from "axios";
import AuthCode from "../../model/auth-code";
import dayjs from "dayjs";
import mail from "../../services/mail";

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
    user = await User.create({
      email: userinfo.email,
      first_name: userinfo.first_name,
      last_name: userinfo.last_name,
      verified: true,
      providers: [userinfo.provider]
    })
  }

  if (!user.providers.includes(userinfo.provider)) {
    await user.updateOne({ $addToSet: { providers: userinfo.provider } })
  }

  const access_token = createAccessToken(user.id)

  return { data: { access_token }, message: "User signin is successful" }
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
    await mail.sendAuthCode(email)
    throw new BadRequestException(
      "Please verify your email address",
      { requires_verification: true }
    )
  }
  const access_token = createAccessToken(user.id, { expiresIn: remember_for_30_days ? "30d" : "7d" })

  return { data: { access_token }, message: "User login is successful" }
}

export async function register(payload: ILogin) {
  const { email } = payload
  const user = await User.findOne({ email })
  if (user) {
    throw new NotFoundException("User with this emaill address aleady exist")
  }

  const password = await hashPassword(payload.password)
  await User.create({ password, email })
  await mail.sendAuthCode(email)

  return { data: null, message: "User registration successful" }
}

export async function sendAuthCode(payload: Pick<IVerifyCode, "email">) {
  const { email } = payload
  const user = await User.findOne({ email })
  if (!user) {
    throw new NotFoundException("User not found")
  }

  await mail.sendAuthCode(email)

  return { message: "Verification code has been sent successfully", data: null }
}

export async function verifyCode(payload: IVerifyCode) {
  const { email, code } = payload

  const user = await User.findOne({ email })
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const authCode = await AuthCode.findOne({ email })
  if (!authCode) {
    throw new BadRequestException("No verification code found. Please request a new code and try again.")
  }
  if (authCode.code !== code) {
    throw new BadRequestException("The verification code you entered is incorrect")
  }
  if (dayjs().isAfter(authCode.expires_at)) {
    throw new BadRequestException("Verification code has exipred")
  }

  const access_token = createAccessToken(user.id, { expiresIn: "1h" })
  await authCode.deleteOne()

  return { data: { access_token }, message: "Verification successful" }
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
