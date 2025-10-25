// Test script to verify the corrected Facebook OAuth URL construction
require('dotenv').config();

const { META_ID, FRONTEND_URL } = {
  META_ID: process.env.META_ID || '769500967651765',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000'
};

const OAUTH_REDIRECT_URL = `${FRONTEND_URL}/oauth/callback`;
const redirect_uri = `${OAUTH_REDIRECT_URL}/facebook`;

console.log('=== Corrected Facebook OAuth URL Construction ===');
console.log('META_ID:', META_ID);
console.log('FRONTEND_URL:', FRONTEND_URL);
console.log('redirect_uri:', redirect_uri);
console.log('');

// New implementation (corrected)
const authoriation_url = `https://www.facebook.com/v19.0/dialog/oauth`;
const scope = "email,public_profile";

console.log('Base authorization URL:', authoriation_url);
console.log('Scope:', scope);

// Build parameters object
const params = {
  client_id: META_ID,
  redirect_uri: redirect_uri,
  response_type: "code",
  scope: scope
};

const queryString = new URLSearchParams(params).toString();
console.log('Query string:', queryString);

const final_url = `${authoriation_url}?${queryString}`;
console.log('Final OAuth URL:', final_url);
console.log('');

// Verify URL structure
console.log('=== URL Structure Verification ===');
const url = new URL(final_url);
console.log('Protocol:', url.protocol);
console.log('Host:', url.host);
console.log('Pathname:', url.pathname);
console.log('Search params:');
for (const [key, value] of url.searchParams) {
  console.log(`  ${key}: ${value}`);
}
console.log('');

// Check for required parameters
console.log('=== Required Parameters Check ===');
const requiredParams = ['client_id', 'redirect_uri', 'response_type', 'scope'];
let allPresent = true;

requiredParams.forEach(param => {
  if (url.searchParams.has(param)) {
    console.log(`✅ ${param}: ${url.searchParams.get(param)}`);
  } else {
    console.log(`❌ ${param}: MISSING`);
    allPresent = false;
  }
});

if (allPresent) {
  console.log('');
  console.log('🎉 All required parameters are present!');
  console.log('The Facebook OAuth URL should now work correctly.');
} else {
  console.log('');
  console.log('⚠️  Some required parameters are missing.');
}
