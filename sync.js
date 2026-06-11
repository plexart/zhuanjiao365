const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置文件路径
const DATA_DIR = './data';
const RESPONSE_FILE = path.join(DATA_DIR, 'response.json');
const SELECTED_FILE = path.join(DATA_DIR, 'selected.json');

// API 配置
const API_URL = 'https://miniapp.zhuanjiao365.com/Ashx/wechatEdit.ashx';

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

// 读取 response.json
function loadResponseData() {
  try {
    const data = fs.readFileSync(RESPONSE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ 无法读取 ${RESPONSE_FILE}:`, err.message);
    process.exit(1);
  }
}

// 读取 selected.json
function loadSelectedData() {
  try {
    const data = fs.readFileSync(SELECTED_FILE, 'utf8');
    const json = JSON.parse(data);
    // 支持两种格式：纯数组或包含 selected 的对象
    if (Array.isArray(json)) {
      return json;
    }
    return [];
  } catch (err) {
    // 文件不存在或格式错误，返回空数组
    return [];
  }
}

// 发送 HTTP 请求
async function sendRequest(orderAlbumId, state, selectMID, signer) {
  const saveInfo = JSON.stringify({
    OrderAlbumID: orderAlbumId,
    State: state.toString(), // "1" = 未选, "2" = 已选
    Remark: null,
    SelectMID: selectMID,
  });

  const payload = {
    fun: 'Edit_OrderAlbumInfo',
    saveInfo: saveInfo,
    signer: signer,
  };

  console.log(
    `   发送请求: OrderAlbumID=${orderAlbumId}, State=${state === 1 ? '未选' : '已选'}`,
  );

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Host: 'miniapp.zhuanjiao365.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541917) XWEB/19749',
        'Content-Type': 'application/json',
        Referer:
          'https://servicewechat.com/wxa796acda177dec09/137/page-frame.html',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (response.ok) {
      console.log(`   ✅ 成功`);
      return true;
    } else {
      console.log(`   ❌ 失败: ${response.status} ${text}`);
      return false;
    }
  } catch (err) {
    console.log(`   ❌ 请求错误: ${err.message}`);
    return false;
  }
}

async function sync() {
  // 获取参数
  const selectMID = await askQuestion('请输入 SelectMID: ');
  if (!selectMID) {
    console.error('❌ SelectMID 不能为空');
    process.exit(1);
  }

  const signer = await askQuestion('请输入 Signer: ');
  if (!signer) {
    console.error('❌ Signer 不能为空');
    process.exit(1);
  }

  // 加载数据
  console.log('📝 加载数据...');
  const responseData = loadResponseData();
  const selectedIds = loadSelectedData();

  // 找到所有 State=2 且 AlbumType=2或4 的元素
  const currentSelected = responseData.ajaxDataTable
    .filter(
      (item) =>
        item.State === 2 && (item.AlbumType === '2' || item.AlbumType === '4'),
    )
    .map((item) => item.OrderAlbumID);

  console.log(`当前已选图片: ${currentSelected.length} 张`);
  console.log(`selected.json 中记录: ${selectedIds.length} 张`);

  // 获取 response.json 中所有有效的 OrderAlbumID（用于验证 selected.json 中的 ID 是否存在）
  const allValidIds = new Set(
    responseData.ajaxDataTable
      .filter((item) => item.AlbumType === '2' || item.AlbumType === '4')
      .map((item) => item.OrderAlbumID),
  );

  // 转换为 Set 方便比较
  const currentSet = new Set(currentSelected);
  const selectedSet = new Set(selectedIds);

  // 找出需要改为未选的（当前已选但不在 selected.json 中）
  const toDeselect = currentSelected.filter((id) => !selectedSet.has(id));

  // 找出需要改为已选的（在 selected.json 中但当前未选，且 ID 在 response.json 中存在）
  const validToSelect = [];
  const invalidIds = [];
  for (const id of selectedIds) {
    if (!currentSet.has(id)) {
      if (allValidIds.has(id)) {
        validToSelect.push(id);
      } else {
        invalidIds.push(id);
      }
    }
  }

  console.log('\n--- 需要改为未选 ---');
  if (toDeselect.length === 0) {
    console.log('无');
  } else {
    toDeselect.forEach((id) => console.log(`  - ${id}`));
  }

  console.log('\n--- 需要改为已选 ---');
  if (validToSelect.length === 0) {
    console.log('无');
  } else {
    validToSelect.forEach((id) => console.log(`  - ${id}`));
  }

  // 列出无效的 ID（在 selected.json 中但不在 response.json 中）
  if (invalidIds.length > 0) {
    console.log(
      `\n⚠️  以下 ${invalidIds.length} 张图片在 response.json 中不存在，将跳过同步：`,
    );
    invalidIds.forEach((id) => console.log(`  - ${id}`));
  }

  if (toDeselect.length === 0 && validToSelect.length === 0) {
    console.log('\n✅ 无需同步');
    return;
  }

  // 确认
  const confirm = await askQuestion('\n是否开始同步? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('已取消');
    return;
  }

  console.log('\n🔄 开始同步...\n');

  // 先改为未选
  for (const id of toDeselect) {
    await sendRequest(id, 1, selectMID, signer);
  }

  // 再改为已选
  for (const id of validToSelect) {
    await sendRequest(id, 2, selectMID, signer);
  }

  console.log('\n✅ 同步完成');
}

sync().catch((err) => {
  console.error('同步失败:', err);
  process.exit(1);
});
