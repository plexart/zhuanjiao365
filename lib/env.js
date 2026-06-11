const fs = require('fs');
const path = require('path');

const ENV_FILE = '.env';

// 默认值
const DEFAULTS = {
  // HTTP headers
  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541917) XWEB/19749',
  REFERER: 'https://servicewechat.com/wxa796acda177dec09/137/page-frame.html',
};

/**
 * 解析 .env 文件内容
 * @param {string} content - .env 文件内容
 * @returns {Object} - 键值对对象
 */
function parseEnv(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * 将对象写入 .env 文件
 * @param {Object} envObj - 环境变量对象
 */
function writeEnv(envObj) {
  let content = '';
  for (const [key, value] of Object.entries(envObj)) {
    content += `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

/**
 * 读取 .env 配置
 * @returns {Object} - 环境变量对象
 */
function loadEnv() {
  let env = {};

  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    env = parseEnv(content);
  }

  return env;
}

/**
 * 获取环境变量，支持默认值
 * @param {string} key - 键名
 * @param {string} [defaultValue] - 默认值
 * @returns {string} - 值
 */
function getEnv(key, defaultValue) {
  const env = loadEnv();
  const value = env[key];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  return null;
}

/**
 * 获取所有配置（包括默认值）
 * @returns {Object} - 完整配置
 */
function getAllConfig() {
  const env = loadEnv();
  return {
    ...DEFAULTS,
    ...env,
  };
}

module.exports = {
  ENV_FILE,
  DEFAULTS,
  parseEnv,
  writeEnv,
  loadEnv,
  getEnv,
  getAllConfig,
};
