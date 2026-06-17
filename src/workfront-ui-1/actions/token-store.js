const fs = require('fs');
const path = require('path');

const TOKEN_STORE_PATH = path.join('/tmp', 'workfront-oauth-tokens.json');

async function loadTokens() {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) {
      return null;
    }

    const raw = await fs.promises.readFile(TOKEN_STORE_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.error('Failed to read token store:', error);
    return null;
  }
}

async function saveTokens(tokens) {
  try {
    await fs.promises.writeFile(TOKEN_STORE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
    return tokens;
  } catch (error) {
    console.error('Failed to write token store:', error);
    throw error;
  }
}

module.exports = {
  loadTokens,
  saveTokens,
};
