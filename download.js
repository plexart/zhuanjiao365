const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { loadEnv, writeEnv, getEnv } = require('./lib/env');

// 配置文件路径
const DATA_DIR = './data';
const RESPONSE_FILE = path.join(DATA_DIR, 'response.json');

// API 配置
const API_URL = 'https://miniapp.zhuanjiao365.com/Ashx/wechatInfo.ashx';

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

/**
 * 从 .env 读取配置，如果不存在或缺少值则提示用户输入
 * @returns {{ orderID: string, infoOrderAlbumListSigner: string }}
 */
async function getConfig() {
  let env = loadEnv();

  // 检查并获取 orderID
  let orderID = env.orderID;
  if (!orderID) {
    orderID = await askQuestion('请输入 orderID: ');
    if (!orderID) {
      console.error('❌ orderID 不能为空');
      process.exit(1);
    }
  }

  // 检查并获取 infoOrderAlbumListSigner
  let infoOrderAlbumListSigner = env.infoOrderAlbumListSigner;
  if (!infoOrderAlbumListSigner) {
    infoOrderAlbumListSigner = await askQuestion(
      '请输入 info_OrderAlbumList signer: ',
    );
    if (!infoOrderAlbumListSigner) {
      console.error('❌ info_OrderAlbumList signer 不能为空');
      process.exit(1);
    }
  }

  // 如果有任何新值，更新 .env 文件
  if (!env.orderID || !env.infoOrderAlbumListSigner) {
    env.orderID = orderID;
    env.infoOrderAlbumListSigner = infoOrderAlbumListSigner;
    writeEnv(env);
    console.log(`✅ 已保存配置到 .env`);
  }

  return { orderID, infoOrderAlbumListSigner };
}

/**
 * 确保 data 目录存在
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 下载 response.json
 */
async function download() {
  // 获取配置
  const { orderID, infoOrderAlbumListSigner } = await getConfig();

  // 确保 data 目录存在
  ensureDataDir();

  console.log('📡 正在下载 response.json...');

  // 从 env 获取 headers，支持自定义
  const userAgent = getEnv('USER_AGENT');
  const referer = getEnv('REFERER');

  const payload = {
    fun: 'info_OrderAlbumList',
    orderID: orderID,
    page: 0,
    pageSize: 0,
    albumType: 0,
    signer: infoOrderAlbumListSigner,
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        xweb_xhr: '1',
        'Content-Type': 'application/json',
        Referer: referer,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`❌ 请求失败: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const text = await response.text();

    // 尝试解析为 JSON
    let jsonData;
    try {
      jsonData = JSON.parse(text);
    } catch (e) {
      console.error('❌ 响应不是有效的 JSON');
      console.error('响应内容:', text);
      process.exit(1);
    }

    // 保存到文件
    fs.writeFileSync(RESPONSE_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`✅ 已保存到 ${RESPONSE_FILE}`);

    // 显示统计信息
    if (jsonData.ajaxDataTable && Array.isArray(jsonData.ajaxDataTable)) {
      const total = jsonData.ajaxDataTable.length;
      const selected = jsonData.ajaxDataTable.filter(
        (item) => item.State === 2,
      ).length;
      console.log(`   共 ${total} 张图片，已选 ${selected} 张`);
    }
  } catch (err) {
    console.error('❌ 下载失败:', err.message);
    process.exit(1);
  }
}

download().catch((err) => {
  console.error('下载失败:', err);
  process.exit(1);
});
