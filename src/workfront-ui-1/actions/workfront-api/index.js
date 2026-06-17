const fetch = global.fetch || require('node-fetch');
const { loadTokens, saveTokens } = require('../token-store');

const buildTokenUrl = (domain) => `https://${domain.replace(/\/+$/g, '')}/integrations/oauth2/api/v1/token`;

const resolveApiPath = (domain, resource) => {
  const cleaned = String(resource || '').trim();
  if (!cleaned) {
    throw new Error('Missing "resource" parameter for Workfront API call.');
  }

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  const path = cleaned.startsWith('/') ? cleaned : `/attask/api/v21.0/${cleaned}`;
  return `https://${domain.replace(/\/+$/g, '')}${path}`;
};

async function refreshToken(domain, clientId, clientSecret, refreshToken) {
  const tokenUrl = buildTokenUrl(domain);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const responseText = await response.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(`Unable to parse refresh token response: ${responseText}`);
  }

  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || payload.message || `HTTP ${response.status}`);
  }

  const now = Date.now();
  const expiresIn = Number(payload.expires_in) || 0;
  const store = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || refreshToken,
    token_type: payload.token_type,
    expires_in: expiresIn,
    expires_at: expiresIn ? now + expiresIn * 1000 : null,
    obtained_at: now,
  };

  await saveTokens(store);
  return store;
}

const parseJsonOrText = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }
  return text;
};

async function callWorkfront(params, accessToken, domain) {
  const method = (params.method || 'GET').toUpperCase();
  const url = resolveApiPath(domain, params.resource);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  const requestOptions = {
    method,
    headers,
  };

  if (method !== 'GET' && params.body) {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
  }

  const response = await fetch(url, requestOptions);
  const data = await parseJsonOrText(response);
  return { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }, data };
}

async function main(params) {
  try {
    const domain = process.env.WORKFRONT_DOMAIN;
    const clientId = process.env.WORKFRONT_CLIENT_ID;
    const clientSecret = process.env.WORKFRONT_CLIENT_SECRET;

    if (!domain || !clientId || !clientSecret) {
      return {
        statusCode: 500,
        body: { error: 'Workfront OAuth credentials are missing in runtime configuration.' },
      };
    }

    const tokens = await loadTokens();
    if (!tokens || !tokens.access_token) {
      return {
        statusCode: 401,
        body: { error: 'Not connected to Workfront. Complete the OAuth flow first.' },
      };
    }

    const now = Date.now();
    let activeTokens = tokens;
    if (tokens.expires_at && now >= tokens.expires_at - 30000) {
      activeTokens = await refreshToken(domain, clientId, clientSecret, tokens.refresh_token);
    }

    const workfrontResponse = await callWorkfront(params, activeTokens.access_token, domain);

    if (workfrontResponse.status === 401 && activeTokens.refresh_token) {
      const refreshed = await refreshToken(domain, clientId, clientSecret, activeTokens.refresh_token);
      const retryResponse = await callWorkfront(params, refreshed.access_token, domain);
      return {
        statusCode: retryResponse.status,
        body: retryResponse.data,
      };
    }

    return {
      statusCode: workfrontResponse.status,
      body: workfrontResponse.data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: { error: error.message || 'Workfront API invocation failed.' },
    };
  }
}

exports.main = main;
