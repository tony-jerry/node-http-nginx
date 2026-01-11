# Node HTTP Nginx

这是一个为 VS Code 打造的轻量级 Nginx 配置预览与模拟工具。它可以直接解析 `nginx.conf` 配置文件，并启动一个本地 Node.js HTTP 服务来模拟 Nginx 的静态资源托管、`location` 匹配和路径转发逻辑。

## 🚀 主要功能

- **一键启停**：在侧边栏直接控制模拟服务的启动、停止与重启。
- **配置解析**：智能解析 Nginx 配置文件，支持 `server`、`location`、`root`、`index`、`proxy_pass`（Mock）和 `try_files` 等指令。
- **智能路径**：自动寻找工作区中的 `nginx.conf` 文件，并支持手动指定路径。
- **状态感知**：状态栏实时显示服务运行状态，点击即可快速重启。
- **输出日志**：在 VS Code 输出面板实时查看 HTTP 请求匹配详情，方便调试。

## 📦 安装

1. 在 VS Code 中打开你的项目。
2. 确保项目根目录或指定位置包含 `nginx.conf` 配置文件。
3. 点击侧边栏的 Nginx 图标进入管理器。

## ⚙️ 插件设置

你可以通过 `settings.json` 或设置界面调整以下配置：

- `nodeHttpNginx.nodeConfigPath`: 指定 `nginx.conf` 的路径（支持相对路径）。
- `nodeHttpNginx.nodeHost`: 设置服务监听的主机地址（默认 `0.0.0.0`）。
- `nodeHttpNginx.nodeOverridePort`: 覆盖 Nginx 配置中的端口号（设为 0 则使用配置中的端口）。
- `nodeHttpNginx.nodeBaseDir`: 设置静态资源查找的基础目录。
- `nodeHttpNginx.showCommandOutput`: 是否在启动时自动弹出输出面板。

## 🛠️ 开发与编译

如果你想从源码构建插件，请遵循以下步骤：

### 1. 安装依赖
```bash
npm install
```
### 2. 打包插件 (.vsix)
使用以下命令将插件打包为安装文件：
```bash
npm run package
```

### 4. 持续集成 (CI)
本项目已配置 GitHub Actions。
- **自动构建**：每次推送到 `main` 分支都会触发自动构建。
- **自动发布**：推送以 `v` 开头的标签（如 `v0.0.2`）将自动创建 GitHub Release 并上传 `.vsix` 安装包。

```bash
git tag v0.0.2
git push origin v0.0.2
```

## 📖 使用说明

1. **选择配置**：点击“选择配置文件”或确保工作区根目录有 `nginx.conf`。
2. **启动服务**：点击“启动服务”，插件将根据配置启动本地服务器。
3. **访问测试**：在浏览器中打开提示的监听地址（如 `http://localhost:80`）。
4. **查看日志**：在“输出”面板下拉选择 `Node HTTP Nginx` 查看请求匹配过程。

## 📄 许可证

本项目采用 [MIT](./LICENSE) 许可证。
