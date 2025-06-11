import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as http from 'http';

import * as chromeManager from './chrome-manager';
import * as contentProxy from './content-proxy';

let currentPanel: vscode.WebviewPanel | undefined;
let devToolsPanel: vscode.WebviewPanel | undefined;
let chromePath: string;
let startUrl: string;
let extensionContext: vscode.ExtensionContext;
let devToolsProcess: cp.ChildProcess | undefined;
let currentPreviewUrl: string | undefined;
let devToolsOutputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;

    devToolsOutputChannel = vscode.window.createOutputChannel("Browser Preview DevTools Log");
    context.subscriptions.push(devToolsOutputChannel);

    try {
        chromeManager.initializeChromeManager(context, devToolsOutputChannel);
        contentProxy.initializeContentProxy(devToolsOutputChannel, chromeManager.getChromeDebugPort(), startUrl);

        const config = vscode.workspace.getConfiguration('browser-preview');
        chromePath = config.get('chromeExecutable') || '';
        startUrl = config.get('startUrl') || 'http://localhost:5173/';

        if (!chromePath || !fs.existsSync(chromePath)) {
            vscode.window.showErrorMessage('请先设置 Chrome 可执行文件路径');
            return;
        }

        let openPreview = vscode.commands.registerCommand('browser-preview.openPreview', async () => {
            const url = await vscode.window.showInputBox({
                prompt: '请输入要预览的 URL',
                placeHolder: startUrl,
                value: startUrl
            });

            if (url) {
                currentPreviewUrl = url;
                const wsDebuggerUrl = await chromeManager.launchChrome(chromePath, url);
                if (wsDebuggerUrl) {
                    await contentProxy.startContentProxy();
                    createOrShowWebviewPanel(url);
                } else {
                    vscode.window.showErrorMessage('未能启动 Chrome 浏览器或获取调试 URL。');
                }
            }
        });

        let openDevTools = vscode.commands.registerCommand('browser-preview.openDevTools', async () => {
            if (currentPanel && currentPreviewUrl) {
                const debugPort = chromeManager.getChromeDebugPort();
                const devToolsFrontendUrl = await getDevToolsFrontendUrl(debugPort, currentPreviewUrl);
                if (devToolsFrontendUrl) {
                    createOrShowDevToolsPanel(devToolsFrontendUrl);
                } else {
                    vscode.window.showErrorMessage('未能获取 DevTools 前端 URL。');
                }
            } else {
                vscode.window.showInformationMessage('请先打开浏览器预览面板并加载一个 URL。');
            }
        });

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('browser-preview')) {
                    const config = vscode.workspace.getConfiguration('browser-preview');
                    chromePath = config.get('chromeExecutable') || '';
                    startUrl = config.get('startUrl') || 'http://localhost:5173/';
                }
            })
        );

        context.subscriptions.push(openPreview, openDevTools);
    } catch (error: any) {
        devToolsOutputChannel.appendLine(`Extension activation failed: ${error.message}`);
        vscode.window.showErrorMessage(`浏览器预览插件激活失败: ${error.message}`);
    }
}

async function getDevToolsFrontendUrl(debugPort: number, targetUrl: string): Promise<string | undefined> {
    let retries = 0;
    const maxRetries = 40;
    const retryInterval = 500;

    return new Promise((resolve) => {
        const fetchUrl = () => {
            http.get(`http://localhost:${debugPort}/json`, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const targets = JSON.parse(data);
                        devToolsOutputChannel.appendLine("All available DevTools targets:");
                        targets.forEach((t: any) => {
                            devToolsOutputChannel.appendLine(`  Type: ${t.type}, URL: ${t.url}, Id: ${t.id}, WebSocket: ${t.webSocketDebuggerUrl}`);
                        });
                        
                        const normalizeUrl = (url: string) => {
                            try {
                                const parsed = new URL(url);
                                if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
                                    parsed.pathname = parsed.pathname.slice(0, -1);
                                }
                                parsed.search = '';
                                parsed.hash = '';
                                return parsed.toString();
                            } catch (e) {
                                return url;
                            }
                        };

                        let pageTarget = targets.find((target: any) => 
                            target.type === 'page' && 
                            target.url && 
                            normalizeUrl(target.url) === normalizeUrl(targetUrl)
                        );
                        
                        if (!pageTarget) {
                            pageTarget = targets.find((target: any) => 
                                target.type === 'page' && 
                                target.url !== 'about:blank' && 
                                target.url !== 'chrome://new-tab-page/' &&
                                !target.url.startsWith('devtools://')
                            );
                        }

                        if (pageTarget && pageTarget.webSocketDebuggerUrl && pageTarget.devtoolsFrontendUrl) {
                            devToolsOutputChannel.appendLine(`Original devToolsFrontendUrl from target: ${pageTarget.devtoolsFrontendUrl}`);
                            let devToolsFrontendUrl = pageTarget.devtoolsFrontendUrl;
                            
                            const debuggerIdMatch = pageTarget.webSocketDebuggerUrl.match(/\/page\/([^/]+)$/);
                            if (debuggerIdMatch && debuggerIdMatch[1]) {
                                const debuggerId = debuggerIdMatch[1];
                                devToolsFrontendUrl = `http://localhost:${debugPort}/devtools/inspector.html?ws=localhost:${debugPort}/devtools/page/${debuggerId}`;
                                devToolsOutputChannel.appendLine('Reconstructed devToolsFrontendUrl with correct ws= parameter.');
                            } else {
                                devToolsOutputChannel.appendLine('Could not extract debugger ID from webSocketDebuggerUrl. Using original devToolsFrontendUrl. If it does not contain ws=, it may not work correctly.');
                                if (!devToolsFrontendUrl.includes('ws=')) {
                                    devToolsOutputChannel.appendLine('Original devToolsFrontendUrl does not contain ws= parameter. May not work correctly for direct connection.');
                                }
                            }

                            resolve(devToolsFrontendUrl);
                        } else {
                            devToolsOutputChannel.appendLine('No suitable inspectable page target found, or missing webSocketDebuggerUrl/devtoolsFrontendUrl, retrying...');
                            if (retries < maxRetries) {
                                retries++;
                                setTimeout(fetchUrl, retryInterval);
                            } else {
                                vscode.window.showErrorMessage('未能找到可调试的页面或 DevTools 前端 URL。请确保预览页面已打开并加载完成。');
                                devToolsOutputChannel.appendLine('Failed: Could not find inspectable page or DevTools frontend URL after retries.');
                                resolve(undefined);
                            }
                        }
                    } catch (e) {
                        devToolsOutputChannel.appendLine(`Failed to parse DevTools JSON: ${e}`);
                        if (retries < maxRetries) {
                            retries++;
                            setTimeout(fetchUrl, retryInterval);
                        } else {
                            vscode.window.showErrorMessage('DevTools 启动失败，无法解析调试信息。');
                            devToolsOutputChannel.appendLine('Failed: DevTools launch failed, could not parse debug info.');
                            resolve(undefined);
                        }
                    }
                });
            }).on('error', (err) => {
                devToolsOutputChannel.appendLine(`Failed to connect to DevTools port ${debugPort}: ${err.message}, retrying...`);
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(fetchUrl, retryInterval);
                } else {
                    vscode.window.showErrorMessage(`未能连接到 Chrome DevTools 端口 ${debugPort}。请确保 Chrome 正常启动且端口未被占用。错误: ${err.message}`);
                    devToolsOutputChannel.appendLine(`Failed: Could not connect to Chrome DevTools port ${debugPort}. Error: ${err.message}`);
                    resolve(undefined);
                }
            });
        };
        fetchUrl();
    });
}

function createOrShowWebviewPanel(url: string) {
    const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    const proxyUrl = `http://localhost:${contentProxy.getProxyPort()}/`;

    if (currentPanel) {
        currentPanel.reveal(columnToShowIn);
        currentPanel.webview.postMessage({ command: 'loadUrl', url: proxyUrl });
    } else {
        currentPanel = vscode.window.createWebviewPanel(
            'browserPreview',
            'Browser Preview',
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionContext.extensionPath, 'dist'))
                ]
            }
        );

        currentPanel.webview.html = getWebviewContent(proxyUrl);

        currentPanel.webview.onDidReceiveMessage(
            (message: any) => {
                console.log('Received message from webview:', message);
                switch (message.command) {
                    case 'openDevTools':
                        vscode.commands.executeCommand('browser-preview.openDevTools');
                        break;
                }
            },
            undefined,
            extensionContext.subscriptions
        );

        currentPanel.onDidDispose(
            () => {
                currentPanel = undefined;
                currentPreviewUrl = undefined;
                chromeManager.disposeChrome();
                contentProxy.stopContentProxy();
            },
            undefined,
            extensionContext.subscriptions
        );
    }
}

function createOrShowDevToolsPanel(devToolsUrl: string) {
    const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    if (devToolsPanel) {
        devToolsPanel.reveal(columnToShowIn);
        devToolsPanel.webview.html = getDevToolsWebviewContent(devToolsUrl);
    } else {
        devToolsPanel = vscode.window.createWebviewPanel(
            'browserDevTools',
            'DevTools - Browser Preview',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionContext.extensionPath, 'dist'))
                ]
            }
        );

        devToolsPanel.webview.html = getDevToolsWebviewContent(devToolsUrl);

        devToolsPanel.onDidDispose(
            () => {
                devToolsPanel = undefined;
            },
            undefined,
            extensionContext.subscriptions
        );
    }
}

function getWebviewContent(url: string) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Browser Preview</title>
        <style>
            body, html {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .toolbar {
                padding: 8px 12px;
                background: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .toolbar button {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 4px 8px;
                background: transparent;
                color: var(--vscode-icon-foreground, #cccccc);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                width: 32px;
                height: 32px;
                transition: background 0.2s;
            }
            .toolbar button:hover {
                background: var(--vscode-toolbar-hoverBackground, #2a2d2e);
            }
            .toolbar .icon {
                width: 20px;
                height: 20px;
                display: inline-block;
            }
            .preview-container {
                flex: 1;
                position: relative;
            }
            iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
        </style>
    </head>
    <body>
        <div class="toolbar">
            <button id="devToolsBtn" title="Open DevTools">
                <span class="icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2C8.89543 2 8 2.89543 8 4V5.12602C6.27447 5.57047 5 7.13616 5 9V10H4C3.44772 10 3 10.4477 3 11V13C3 13.5523 3.44772 14 4 14H5V15C5 16.8638 6.27447 18.4295 8 18.874V20H12V18.874C13.7255 18.4295 15 16.8638 15 15V14H16C16.5523 14 17 13.5523 17 13V11C17 10.4477 16.5523 10 16 10H15V9C15 7.13616 13.7255 5.57047 12 5.12602V4C12 2.89543 11.1046 2 10 2ZM7 9C7 7.34315 8.34315 6 10 6C11.6569 6 13 7.34315 13 9V10H7V9ZM7 12C7 13.1046 7.89543 14 9 14C10.1046 14 11 13.1046 11 12V11H7V12ZM13 12C13 13.1046 12.1046 14 11 14C9.89543 14 9 13.1046 9 12V11H13V12Z" fill="currentColor"/>
                  </svg>
                </span>
            </button>
        </div>
        <div class="preview-container">
            <iframe src="${url}" id="preview"></iframe>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const iframe = document.getElementById('preview');
            const devToolsBtn = document.getElementById('devToolsBtn');
            
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'loadUrl':
                        iframe.src = message.url;
                        break;
                }
            });

            devToolsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openDevTools' });
            });
        </script>
    </body>
    </html>`;
}

function getDevToolsWebviewContent(devToolsUrl: string) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DevTools</title>
        <style>
            body, html {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
            }
            iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
        </style>
    </head>
    <body>
        <iframe src="${devToolsUrl}" id="devtools-frame"></iframe>
    </body>
    </html>`;
}

export function deactivate() {
    chromeManager.disposeChrome();
    contentProxy.stopContentProxy();
} 