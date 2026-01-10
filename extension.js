const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');

const CONFIG_SECTION = 'nodeHttpNginx';

let statusBarItem;
let outputChannel;
let treeDataProvider;
let nodeHttpServer;
let sockets = new Set();

/**
 * @description 常用文件的 MIME 类型映射表
 */
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf'
};

/**
 * @description 获取插件配置对象
 * @returns {vscode.WorkspaceConfiguration}
 */
function getConfig() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * @description 获取是否在输出面板显示命令输出
 * @returns {boolean}
 */
function getShowOutput() {
  return !!getConfig().get('showCommandOutput');
}

/**
 * @description 获取配置的 nginx.conf 路径
 * @returns {string}
 */
function getNodeConfigPath() {
  return String(getConfig().get('nodeConfigPath') || '').trim();
}

/**
 * @description 获取配置的基础目录（静态文件根目录）
 * @returns {string}
 */
function getNodeBaseDir() {
  return String(getConfig().get('nodeBaseDir') || '').trim();
}

/**
 * @description 获取配置的监听主机地址
 * @returns {string}
 */
function getNodeHost() {
  return String(getConfig().get('nodeHost') || '0.0.0.0').trim();
}

/**
 * @description 获取配置的覆盖端口
 * @returns {number}
 */
function getNodeOverridePort() {
  return Number(getConfig().get('nodeOverridePort') || 0);
}

/**
 * @description 更新插件的运行状态（用于 UI 显示）
 * @param {string} nextState 状态值 ('running' | 'stopped')
 */
async function setNodeUiState(nextState) {
  await getConfig().update('nodeCurrentState', nextState, vscode.ConfigurationTarget.Workspace);
}

/**
 * @description 获取当前工作区根目录路径
 * @returns {string}
 */
function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return (folders && folders.length) ? folders[0].uri.fsPath : '';
}

/**
 * @description 将相对路径解析为工作区绝对路径
 * @param {string} maybePath 可能是相对也可能是绝对的路径
 * @returns {string}
 */
function resolvePathInWorkspace(maybePath) {
  const p = String(maybePath || '').trim();
  if (!p || path.isAbsolute(p)) return p;
  const root = getWorkspaceRoot();
  return root ? path.join(root, p) : p;
}

/**
 * @description 自动寻找或解析有效的 nginx.conf 路径
 * @returns {Promise<string>}
 */
async function resolveNodeConfigPath() {
  const configured = getNodeConfigPath();
  if (configured) {
    const p = resolvePathInWorkspace(configured);
    try {
      await fs.promises.access(p);
      return p;
    } catch {
      // 路径不可访问，继续搜索
    }
  }

  const root = getWorkspaceRoot();
  if (root) {
    const direct = path.join(root, 'nginx.conf');
    try {
      await fs.promises.access(direct);
      return direct;
    } catch {
      // 文件不存在，继续搜索
    }
  }

  // 全局搜索 nginx.conf，排除常见目录
  const uris = await vscode.workspace.findFiles('**/nginx.conf', '**/{dist,build,out,.git,node_modules}/**', 50);
  if (!uris.length) return '';

  // 简单的评分排序：路径越短越优先，避开 node_modules
  const picked = uris.slice().sort((a, b) => a.fsPath.length - b.fsPath.length)[0];
  return picked?.fsPath || '';
}

/**
 * @description 解析 Node 服务器的基础目录
 * @param {string} configPath nginx.conf 的路径
 * @returns {string}
 */
function resolveNodeBaseDir(configPath) {
  const baseSetting = getNodeBaseDir();
  if (baseSetting) return resolvePathInWorkspace(baseSetting);
  const root = getWorkspaceRoot();
  return root || path.dirname(configPath);
}

/**
 * @description 尝试将绝对路径转换为相对于工作区的路径
 * @param {string} absPath 绝对路径
 * @returns {string}
 */
function toWorkspaceRelativeIfPossible(absPath) {
  const full = String(absPath || '').trim();
  if (!full) return '';
  const root = getWorkspaceRoot();
  if (!root) return full;
  
  const rootResolved = path.resolve(root);
  const fileResolved = path.resolve(full);
  const rootLower = rootResolved.toLowerCase();
  const fileLower = fileResolved.toLowerCase();
  
  if (fileLower === rootLower) return '.';
  if (fileLower.startsWith(rootLower + path.sep)) {
    return path.relative(rootResolved, fileResolved);
  }
  return full;
}

/**
 * @description 确保输出面板已创建
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.OutputChannel}
 */
function ensureOutputChannel(context) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Node HTTP Nginx');
    context.subscriptions.push(outputChannel);
  }
  return outputChannel;
}

/**
 * @description 确保状态栏图标已创建
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.StatusBarItem}
 */
function ensureStatusBarItem(context) {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'nodeHttpNginx.nodeRestart';
    context.subscriptions.push(statusBarItem);
  }
  return statusBarItem;
}

/**
 * @description 根据服务运行状态更新状态栏显示
 */
function updateStatusBar() {
  if (!statusBarItem) return;
  const state = getConfig().get('nodeCurrentState') || 'stopped';
  if (state === 'running') {
    statusBarItem.text = '$(zap) Nginx: Running';
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = '点击重启 Nginx 模拟服务';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

/**
 * @description 将 Nginx 配置文件内容解析为 Token 列表
 * @param {string} text 配置内容
 * @returns {string[]}
 */
function tokenizeNginxConf(text) {
  const tokens = [];
  let i = 0;
  let current = '';
  let quote = null;
  function pushCurrent() {
    if (!current) return;
    tokens.push(current);
    current = '';
  }
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '\\' && i + 1 < text.length) {
        current += text[i + 1];
        i += 2;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '#') {
      pushCurrent();
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      pushCurrent();
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === ';') {
      pushCurrent();
      tokens.push(ch);
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  pushCurrent();
  return tokens;
}

/**
 * @description 将 Token 列表解析为抽象语法树 (AST)
 * @param {string[]} tokens
 * @returns {object[]}
 */
function parseNginxTokens(tokens) {
  let idx = 0;
  function parseBlock() {
    const items = [];
    while (idx < tokens.length) {
      const t = tokens[idx];
      if (t === '}') {
        idx += 1;
        break;
      }
      const parts = [];
      while (idx < tokens.length) {
        const cur = tokens[idx];
        if (cur === ';' || cur === '{' || cur === '}') break;
        parts.push(cur);
        idx += 1;
      }
      const end = tokens[idx];
      if (!parts.length) {
        idx += 1;
        continue;
      }
      const name = parts[0];
      const args = parts.slice(1);
      if (end === ';') {
        idx += 1;
        items.push({ type: 'directive', name, args });
        continue;
      }
      if (end === '{') {
        idx += 1;
        const children = parseBlock();
        items.push({ type: 'block', name, args, children });
        continue;
      }
      if (end === '}') {
        items.push({ type: 'directive', name, args });
        continue;
      }
      idx += 1;
    }
    return items;
  }
  return parseBlock();
}

/**
 * @description 在 AST 中查找特定名称的 Block
 * @param {object[]} ast
 * @param {string} name
 * @returns {object[]}
 */
function findBlocks(ast, name) {
  return ast.filter(node => node?.type === 'block' && node.name === name);
}

/**
 * @description 在 AST 中查找特定名称的 Directive
 * @param {object[]} ast
 * @param {string} name
 * @returns {object[]}
 */
function findDirectives(ast, name) {
  return ast.filter(node => node?.type === 'directive' && node.name === name);
}

/**
 * @description 解析 listen 指令中的端口号
 * @param {string[]} args 指令参数
 * @returns {number}
 */
function parseListenPort(args) {
  if (!Array.isArray(args) || !args.length) return 80;
  const s = String(args[0]);
  const m = s.match(/:(\d+)$/);
  if (m) return parseInt(m[1], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return 80;
}

/**
 * @description 解析 index 指令中的默认文件列表
 * @param {string[]} args 指令参数
 * @returns {string[]}
 */
function parseIndexList(args) {
  if (!Array.isArray(args) || !args.length) return ['index.html', 'index.htm'];
  return args.map(s => String(s || '').trim()).filter(Boolean);
}

/**
 * @description 解析 try_files 指令中的路径
 * @param {string[]} args 指令参数
 * @returns {string[] | null}
 */
function parseTryFiles(args) {
  if (!Array.isArray(args) || !args.length) return null;
  const out = args.map(s => String(s || '').trim()).filter(Boolean);
  return out.length ? out : null;
}

/**
 * @description 从 AST 构建简化的服务器配置
 * @param {object[]} ast
 * @param {string} configFilePath
 * @param {string} baseDir
 * @returns {object | null}
 */
function buildNodeServerConfigFromAst(ast, configFilePath, baseDir) {
  const httpBlock = findBlocks(ast, 'http')[0];
  if (!httpBlock) return null;
  const server = findBlocks(httpBlock.children || [], 'server')[0];
  if (!server) return null;

  const listenDir = findDirectives(server.children || [], 'listen')[0];
  const serverRootDir = findDirectives(server.children || [], 'root')[0];
  const serverIndexDir = findDirectives(server.children || [], 'index')[0];

  const listenPort = parseListenPort(listenDir?.args);
  const serverRoot = serverRootDir?.args?.[0] ? path.resolve(baseDir, String(serverRootDir.args[0])) : baseDir;
  const serverIndex = serverIndexDir ? parseIndexList(serverIndexDir?.args) : ['index.html', 'index.htm'];

  const locations = [];
  for (const block of findBlocks(server.children || [], 'location')) {
    const args = Array.isArray(block.args) ? block.args.map(String) : [];
    const modifier = args[0] || '';
    let kind = 'prefix';
    let matcherValue = '/';
    let flags = '';
    let noRegex = false;

    if (modifier === '=') {
      kind = 'exact';
      matcherValue = args[1] || '/';
    } else if (modifier === '~' || modifier === '~*') {
      kind = 'regex';
      matcherValue = args[1] || '';
      flags = modifier === '~*' ? 'i' : '';
    } else if (modifier === '^~') {
      kind = 'prefix';
      matcherValue = args[1] || '/';
      noRegex = true;
    } else {
      kind = 'prefix';
      matcherValue = args[0] || '/';
    }

    locations.push({
      kind,
      matcher: matcherValue,
      noRegex,
      regex: kind === 'regex' ? new RegExp(matcherValue, flags) : null,
      proxyPass: findDirectives(block.children || [], 'proxy_pass')[0]?.args?.[0],
      root: findDirectives(block.children || [], 'root')[0]?.args?.[0],
      tryFiles: parseTryFiles(findDirectives(block.children || [], 'try_files')[0]?.args)
    });
  }

  return { listenPort, serverRoot, serverIndex, locations };
}

/**
 * @description 根据请求路径匹配最合适的 Location
 * @param {object} cfg 服务器配置
 * @param {string} pathname 请求路径
 * @returns {object | null}
 */
function pickLocation(cfg, pathname) {
  const locations = Array.isArray(cfg.locations) ? cfg.locations : [];
  
  // 1. 精确匹配
  const exact = locations.filter(l => l.kind === 'exact' && l.matcher === pathname);
  if (exact.length) return exact[0];

  // 2. 前缀匹配
  const prefixes = locations
    .filter(l => l.kind === 'prefix' && typeof l.matcher === 'string' && pathname.startsWith(l.matcher))
    .sort((a, b) => b.matcher.length - a.matcher.length);

  const bestPrefix = prefixes.length ? prefixes[0] : null;
  if (bestPrefix?.noRegex) return bestPrefix;

  // 3. 正则匹配
  for (const l of locations) {
    if (l.kind === 'regex' && l.regex?.test(pathname)) return l;
  }

  return bestPrefix;
}

/**
 * @description 安全地拼接路径，防止路径遍历漏洞
 * @param {string} rootDir 根目录
 * @param {string} requestPath 请求路径
 * @returns {string | null}
 */
function safeJoin(rootDir, requestPath) {
  const normalized = path.posix.normalize(String(requestPath || '/').replace(/\\/g, '/'));
  const withoutLeading = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(rootDir, withoutLeading);
  const rootResolved = path.resolve(rootDir);
  
  if (candidate.toLowerCase() === rootResolved.toLowerCase()) return candidate;
  if (!candidate.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * @description 停止正在运行的 Node 模拟服务
 */
async function nodeStop() {
  try {
    if (nodeHttpServer) {
      // 强制关闭所有存活的连接，否则 server.close() 会等待连接自然关闭
      if (sockets.size > 0) {
        for (const socket of sockets) {
          socket.destroy();
        }
        sockets.clear();
      }

      try {
        nodeHttpServer.close();
      } catch (e) {
        console.error('停止服务器时出错:', e);
      }
      
      nodeHttpServer = undefined;
      await setNodeUiState('stopped');
      updateStatusBar();
      if (treeDataProvider) treeDataProvider.refresh();
      vscode.window.showInformationMessage('Node Nginx 模拟服务已停止。');
    }
  } catch (error) {
    vscode.window.showErrorMessage(`停止服务时发生错误: ${error.message}`);
  }
}

/**
 * @description 打开插件设置界面
 */
async function openSettings() {
  await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
}

/**
 * @description 弹出对话框让用户手动选择 nginx.conf
 */
async function selectNodeConfig() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: '选择 nginx.conf'
  });
  if (!picked?.length) return;
  
  const abs = picked[0].fsPath;
  const saved = toWorkspaceRelativeIfPossible(abs);
  await getConfig().update('nodeConfigPath', saved, vscode.ConfigurationTarget.Workspace);

  const root = getWorkspaceRoot();
  if (root) {
    const rootLower = path.resolve(root).toLowerCase();
    const fileLower = path.resolve(abs).toLowerCase();
    if (fileLower.startsWith(rootLower + path.sep)) {
      await getConfig().update('nodeBaseDir', '', vscode.ConfigurationTarget.Workspace);
    } else {
      await getConfig().update('nodeBaseDir', path.dirname(abs), vscode.ConfigurationTarget.Workspace);
    }
  }

  if (treeDataProvider) treeDataProvider.refresh();
}

/**
 * @description 在编辑器中打开当前使用的 nginx.conf
 */
async function openNodeConfig() {
  const configPath = await resolveNodeConfigPath();
  if (!configPath) {
    vscode.window.showErrorMessage('未找到 nginx.conf（请先选择或设置 nodeHttpNginx.nodeConfigPath）。');
    return;
  }
  return openFile(configPath);
}

/**
 * @description 树视图中的项
 */
class NginxItem extends vscode.TreeItem {
  constructor(label, collapsibleState, meta) {
    super(label, collapsibleState);
    this.meta = meta;
  }
}

/**
 * @description 树视图数据提供者，管理 UI 上的操作菜单
 */
class NginxTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      const resolvedNodeConfig = await resolveNodeConfigPath();
      const status = nodeHttpServer ? '运行中' : '已停止';
      const items = [
        { 
          label: `服务状态: ${status}`, 
          icon: nodeHttpServer 
            ? new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.green')) 
            : new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('charts.red')) 
        },
        resolvedNodeConfig 
        ? { label: '编辑配置文件', command: 'nodeHttpNginx.openFile', arguments: [resolvedNodeConfig], icon: new vscode.ThemeIcon('edit') }
        : { label: '配置 nginx.conf', command: 'nodeHttpNginx.selectNodeConfig', icon: new vscode.ThemeIcon('file-add') },
        { label: '启动服务', command: 'nodeHttpNginx.nodeStart', icon: new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green')) },
        { label: '停止服务', command: 'nodeHttpNginx.nodeStop', icon: new vscode.ThemeIcon('primitive-square', new vscode.ThemeColor('charts.red')) },
        { label: '重启服务', command: 'nodeHttpNginx.nodeRestart', icon: new vscode.ThemeIcon('refresh', new vscode.ThemeColor('charts.blue')) },
        { label: '插件设置', command: 'nodeHttpNginx.openSettings', icon: new vscode.ThemeIcon('settings-gear') }
      ];
      return items.map(it => {
        const node = new NginxItem(it.label, vscode.TreeItemCollapsibleState.None, { command: it.command });
        if (it.command) {
          node.command = { command: it.command, title: it.label, arguments: it.arguments };
        }
        if (it.icon) node.iconPath = it.icon;
        return node;
      });
    }
    return [];
  }
}

/**
 * @description 在 VS Code 中打开文件
 * @param {string} filePath 文件绝对路径
 */
async function openFile(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (e) {
    vscode.window.showErrorMessage(`无法打开文件: ${e.message}`);
  }
}

/**
 * @description 核心逻辑：启动 Node HTTP 模拟服务
 * @param {vscode.ExtensionContext} context 插件上下文
 */
async function nodeStart(context) {
  try {
    if (nodeHttpServer) {
      vscode.window.showWarningMessage('Node Nginx 模拟服务已在运行。');
      return;
    }

    // 1. 寻找 nginx.conf
    const configPath = await resolveNodeConfigPath();
    if (!configPath) {
      vscode.window.showErrorMessage('未找到 nginx.conf（请在工作区放置 nginx.conf，或通过设置指定路径）。');
      return;
    }

    // 2. 读取并解析配置
    let text;
    try {
      text = await fs.promises.readFile(configPath, 'utf8');
    } catch (e) {
      vscode.window.showErrorMessage(`读取 nginx.conf 失败：${e?.message || String(e)}`);
      return;
    }

    const tokens = tokenizeNginxConf(text);
    const ast = parseNginxTokens(tokens);
    const baseDir = resolveNodeBaseDir(configPath);
    const cfg = buildNodeServerConfigFromAst(ast, configPath, baseDir);
    if (!cfg) {
      vscode.window.showErrorMessage('解析 nginx.conf 失败：未找到有效的 http/server 配置块。');
      return;
    }

    // 3. 准备启动参数
    const overridePort = getNodeOverridePort();
    const port = overridePort || cfg.listenPort || 80;
    const host = getNodeHost();
    const output = ensureOutputChannel(context);
    if (getShowOutput()) output.show(true);

    output.appendLine(`> [${new Date().toLocaleTimeString()}] 正在启动服务...`);
    output.appendLine(`- 配置文件: ${configPath}`);
    output.appendLine(`- 资源根目录: ${baseDir}`);
    output.appendLine(`- 监听地址: http://${host}:${port}`);

    // 4. 创建并启动 HTTP 服务
    nodeHttpServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        const loc = pickLocation(cfg, pathname);
        
        output.appendLine(`[请求] ${req.method} ${pathname} -> 匹配: ${loc?.matcher || 'default'}`);

        // 处理代理 (Mock)
        if (loc?.proxyPass) {
          output.appendLine(`[代理] 转发至 ${loc.proxyPass} (当前仅返回 Mock 响应)`);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`[Mock] 已匹配代理路径: ${loc.proxyPass}`);
          return;
        }

        // 处理静态文件
        const rootDir = loc?.root ? resolvePathInWorkspace(loc.root) : cfg.serverRoot;
        const filePath = safeJoin(rootDir, pathname);
        
        if (!filePath) {
          res.writeHead(403);
          res.end('403 Forbidden');
          return;
        }

        // 尝试寻找文件
        let targetPath = filePath;
        let stats;
        try {
          stats = await fs.promises.stat(targetPath);
          if (stats.isDirectory()) {
            // 尝试 index 文件
            let foundIndex = false;
            for (const idxName of cfg.serverIndex) {
              const idxPath = path.join(targetPath, idxName);
              try {
                const idxStats = await fs.promises.stat(idxPath);
                if (idxStats.isFile()) {
                  targetPath = idxPath;
                  stats = idxStats;
                  foundIndex = true;
                  break;
                }
              } catch {}
            }
            
            // 处理 try_files
            if (!foundIndex && loc?.tryFiles) {
              for (const tf of loc.tryFiles) {
                if (tf.startsWith('/')) {
                  const tfPath = path.join(rootDir, tf);
                  try {
                    const tfStats = await fs.promises.stat(tfPath);
                    if (tfStats.isFile()) {
                      targetPath = tfPath;
                      stats = tfStats;
                      foundIndex = true;
                      break;
                    }
                  } catch {}
                }
              }
            }
            
            if (!foundIndex) {
              res.writeHead(404);
              res.end('404 Not Found (Directory index not found)');
              return;
            }
          }
        } catch { 
          // 处理 try_files (如果文件不存在)
          let foundTry = false;
          if (loc?.tryFiles) {
            for (const tf of loc.tryFiles) {
              if (tf.startsWith('/')) {
                const tfPath = path.join(rootDir, tf);
                try {
                  const tfStats = await fs.promises.stat(tfPath);
                  if (tfStats.isFile()) {
                    targetPath = tfPath;
                    stats = tfStats;
                    foundTry = true;
                    break;
                  }
                } catch {}
              }
            }
          }
          
          if (!foundTry) {
            res.writeHead(404);
            res.end('404 Not Found');
            return;
          }
        }

        // 读取并返回文件
        const ext = path.extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(targetPath).pipe(res);

      } catch (err) {
        output.appendLine(`[错误] 处理请求失败: ${err.message}`);
        res.writeHead(500);
        res.end('500 Internal Server Error');
      }
    });

    nodeHttpServer.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    nodeHttpServer.on('error', (e) => {
      output.appendLine(`[致命错误] 服务异常终止: ${e.message}`);
      // @ts-ignore
      if (e.code === 'EADDRINUSE') {
        vscode.window.showErrorMessage(`启动失败：端口 ${port} 已被占用。`);
      } else {
        vscode.window.showErrorMessage(`服务异常终止: ${e.message}`);
      }
      nodeStop();
    });

    nodeHttpServer.listen(port, host, async () => {
      output.appendLine(`[成功] 服务已就绪: http://${host}:${port}`);
      vscode.window.showInformationMessage(`Node Nginx 模拟服务已启动: http://${host}:${port}`);
      await setNodeUiState('running');
      updateStatusBar();
      if (treeDataProvider) treeDataProvider.refresh();
    });
  } catch (error) {
    vscode.window.showErrorMessage(`启动服务时发生意外错误: ${error.message}`);
    if (outputChannel) {
      outputChannel.appendLine(`[异常] ${error.stack}`);
    }
  }
}

/**
 * @description 重启模拟服务
 * @param {vscode.ExtensionContext} context 插件上下文
 */
async function nodeRestart(context) {
  await nodeStop();
  return nodeStart(context);
}

/**
 * @description 插件激活时的回调
 * @param {vscode.ExtensionContext} context 插件上下文
 */
function activate(context) {
  // 初始化 UI 组件
  ensureStatusBarItem(context);
  updateStatusBar();

  treeDataProvider = new NginxTreeDataProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('nodeHttpNginx.view', treeDataProvider));

  // 监听配置变化以实时更新 UI
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        updateStatusBar();
        if (treeDataProvider) treeDataProvider.refresh();
      }
    })
  );

  // 注册插件提供的所有命令
  context.subscriptions.push(
    vscode.commands.registerCommand('nodeHttpNginx.nodeStart', () => nodeStart(context)),
    vscode.commands.registerCommand('nodeHttpNginx.nodeStop', () => nodeStop()),
    vscode.commands.registerCommand('nodeHttpNginx.nodeRestart', () => nodeRestart(context)),
    vscode.commands.registerCommand('nodeHttpNginx.selectNodeConfig', () => selectNodeConfig()),
    vscode.commands.registerCommand('nodeHttpNginx.openNodeConfig', () => openNodeConfig()),
    vscode.commands.registerCommand('nodeHttpNginx.openSettings', () => openSettings()),
    vscode.commands.registerCommand('nodeHttpNginx.openFile', (fp) => openFile(fp))
  );
}

/**
 * @description 插件停用时的清理逻辑
 */
function deactivate() {
  if (nodeHttpServer) {
    if (sockets.size > 0) {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
    }
    try {
      nodeHttpServer.close();
    } catch {
      // 忽略关闭时的异常
    }
    nodeHttpServer = undefined;
  }
}

module.exports = {
  activate,
  deactivate
};
