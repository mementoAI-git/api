import { APPLE_ID, APPLE_SECRET, FRONTEND_URL, GOOGLE_ID, GOOGLE_SECRET, META_ID, META_SECRET } from "./config";

const OAUTH_REDIRECT_URL = `${FRONTEND_URL}/auth/callback`

export const GOOGLE_OAUTH_URL = `https://accounts.google.com/o/oauth2/auth?client_id=${GOOGLE_ID}&redirect_uri=${OAUTH_REDIRECT_URL}/google&response_type=code&scope=email profile openid`;
export const APPLE_OAUTH_URL = `https://appleid.apple.com/auth/authorize?client_id=${APPLE_ID}&redirect_uri=${OAUTH_REDIRECT_URL}/apple&response_type=code&scope=email name`;
export const META_OAUTH_URL = `https://www.facebook.com/v12.0/dialog/oauth?client_id=${META_ID}&redirect_uri=${OAUTH_REDIRECT_URL}/meta&scope=email,public_profile`

export const OAUTH_PROVIDERS = {
  google: {
    authoriation_url: `https://accounts.google.com/o/oauth2/auth?client_id=${GOOGLE_ID}&scope=email profile openid`,
    token_url: "https://oauth2.googleapis.com/token",
    userinfo_url: "https://www.googleapis.com/oauth2/v2/userinfo",
    client_id: GOOGLE_ID,
    client_secret: GOOGLE_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/google`,
    fields: ['email', "given_name", "family_name"]
  },
  facebook: {
    authoriation_url: `https://www.facebook.com/v12.0/dialog/oauth?client_id=${META_ID}&scope=email,public_profile`,
    token_url: "https://graph.facebook.com/v12.0/oauth/access_token",
    userinfo_url: "https://graph.facebook.com/me?fields=id,name,email,picture",
    client_id: META_ID,
    client_secret: META_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/facebook`,
  },
  apple: {
    authoriation_url: `https://appleid.apple.com/auth/authorize?client_id=${APPLE_ID}&scope=email name`,
    token_url: "https://appleid.apple.com/auth/token",
    userinfo_url: "",
    client_id: APPLE_ID,
    client_secret: APPLE_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/apple`,
  },
};