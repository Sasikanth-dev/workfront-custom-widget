const fetch = global.fetch || require('node-fetch');
const { saveTokens } = require('../token-store');

const requireParam = (name, value) => {
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required parameter: ${name}`);
  }
};

const buildTokenUrl = (domain) => `https://${domain.replace(/\/+$/g, '')}/integrations/oauth2/api/v1/token`;

const buildAuthHtml = (message, details = '') => {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Workfront OAuth Callback</title></head><body><h1>Workfront OAuth</h1><p>${message}</p><pre>${details}</pre></body></html>`;
};

async function exchangeCode({ domain, clientId, clientSecret, redirectUri, code }) {
  const tokenUrl = buildTokenUrl(domain);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const responseBody = await response.text();
  let payload;
  try {
    payload = responseBody ? JSON.parse(responseBody) : {};
  } catch (error) {
    throw new Error(`Unable to parse token response: ${responseBody}`);
  }

  if (!response.ok || payload.error) {
    const message = payload.error_description || payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(`Token exchange failed: ${message}`);
  }

  return payload;
}

async function main(params) {
  try {
    const clientId = process.env.WORKFRONT_CLIENT_ID;
    const clientSecret = process.env.WORKFRONT_CLIENT_SECRET;
    const redirectUri = process.env.WORKFRONT_REDIRECT_URI;
    const domain = process.env.WORKFRONT_DOMAIN;
    const code = params.code || params['oauth_verifier'] || params.authorization_code;

    requireParam('WORKFRONT_DOMAIN', domain);
    requireParam('WORKFRONT_CLIENT_ID', clientId);
    requireParam('WORKFRONT_CLIENT_SECRET', clientSecret);
    requireParam('WORKFRONT_REDIRECT_URI', redirectUri);
    requireParam('code', code);

    const tokenResponse = await exchangeCode({ domain, clientId, clientSecret, redirectUri, code });
    const now = Date.now();
    const expiresIn = Number(tokenResponse.expires_in) || 0;
    const store = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      token_type: tokenResponse.token_type,
      expires_in: expiresIn,
      expires_at: expiresIn ? now + expiresIn * 1000 : null,
      obtained_at: now,
    };

    await saveTokens(store);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: buildAuthHtml('Authorization succeeded. Tokens were stored for this runtime instance.', JSON.stringify(store, null, 2)),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/html',
      },
      body: buildAuthHtml('Authorization failed.', error.message),
    };
  }
}

exports.main = main;
