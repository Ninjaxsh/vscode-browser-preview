# VSCode Browser Preview

一个基于 TypeScript + Vite 的 VSCode 扩展，用于在 VSCode 中预览网站并支持 DevTools 调试。

## 功能特点

- 🚀 在 VSCode 中直接预览网站
- 🔧 支持打开 DevTools 进行调试
- ⚡ 基于 Vite 构建，性能优异
- 🛠 使用 TypeScript 开发，类型安全
- 📦 使用 pnpm 作为包管理器
- ⌨️ 支持快捷键操作

## 安装要求

- VSCode 1.100.0 或更高版本
- Chrome 浏览器（需要配置可执行文件路径）

## 配置说明

在使用之前，您需要配置以下设置：

1. 打开 VSCode 设置
2. 搜索 "browser-preview"
3. 配置以下选项：
   - `browser-preview.chromeExecutable`: Chrome 浏览器的可执行文件路径
   - `browser-preview.startUrl`: 默认启动页面 URL（默认为 https://www.google.com）

## 使用方法

### 命令

- `Open Browser Preview`: 打开浏览器预览窗口
- `Open Debug Page`: 打开 DevTools 调试工具

### 快捷键

- Windows/Linux: `Ctrl+Shift+B`
- Mac: `Cmd+Shift+B`

## 开发

### 环境要求

- Node.js
- pnpm 9.4.0 或更高版本

### 安装依赖

```bash
pnpm install
```

### 开发命令

```bash
# 构建项目
pnpm run build

# 打包插件
pnpm run pack
```

## 项目结构

```
vscode-browser-preview/
├── src/
│   ├── extension.ts      # 主要扩展代码
│   └── webview/
│       └── index.html    # Webview 界面
├── package.json          # 项目配置和依赖
├── tsconfig.json         # TypeScript 配置
├── vite.config.ts        # Vite 配置
└── .vscodeignore        # VSCode 插件打包忽略文件
```

## 许可证

MIT License

## 作者

- 姓名：Charles Scott
- 邮箱：mark.xsq@gmail.com
- GitHub：[Ninjaxsh](https://github.com/Ninjaxsh)

## 问题反馈

如果您在使用过程中遇到任何问题，欢迎在 GitHub 仓库中提交 Issue。

## 贡献指南

欢迎提交 Pull Request 来改进这个项目。在提交之前，请确保：

1. 代码符合项目的编码规范
2. 添加了必要的测试
3. 更新了相关文档

## 更新日志

### 0.0.1

- 初始版本发布
- 支持基本的网站预览功能
- 支持 DevTools 调试
- 添加默认启动页配置
- 添加快捷键支持 