import * as http from 'http';
import * as vscode from 'vscode';
import httpProxy from 'http-proxy';
const CDP = require('chrome-remote-interface');

let _outputChannel: vscode.OutputChannel | undefined;
let _chromeDebugPort: number;
let _proxyPort = 9000;
let _targetUrl: string;
let proxyServer: any;
let httpServer: http.Server | undefined;

export function initializeContentProxy(outputChannel: vscode.OutputChannel, chromeDebugPort: number, targetUrl: string) {
    _outputChannel = outputChannel;
    _chromeDebugPort = chromeDebugPort;
    _targetUrl = targetUrl;
}

export function getProxyPort(): number {
    return _proxyPort;
}

export async function startContentProxy(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (httpServer && httpServer.listening) {
            _outputChannel?.appendLine('Content proxy server already running.');
            resolve();
            return;
        }

        proxyServer = httpProxy.createProxyServer({});

        proxyServer.on('error', (err: any, req: any, res: any) => {
            _outputChannel?.appendLine(`Proxy error: ${err.message}`);
            if (res.writeHead) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end(`Proxy error: ${err.message}`);
        });

        // 添加 CORS 头到所有响应
        proxyServer.on('proxyRes', function (proxyRes: http.IncomingMessage, req: http.IncomingMessage, res: http.ServerResponse) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        });

        httpServer = http.createServer((req, res) => {
            _outputChannel?.appendLine(`Proxy request received: ${req.method} ${req.url}`);

            // 处理 OPTIONS 预检请求
            if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
                    'Access-Control-Allow-Credentials': 'true',
                    'Access-Control-Max-Age': '86400'
                });
                res.end();
                return;
            }

            // 解析请求 URL
            let targetUrl = _targetUrl;
            let pathRewrite: ((path: string) => string) | undefined;

            if (req.url) {
                try {
                    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
                    const targetOrigin = new URL(_targetUrl).origin;
                    
                    // 如果请求的是外部域名，则代理到该域名
                    if (requestUrl.hostname !== 'localhost' && requestUrl.hostname !== '127.0.0.1') {
                        targetUrl = requestUrl.origin;
                        pathRewrite = (path: string) => requestUrl.pathname + requestUrl.search;
                        _outputChannel?.appendLine(`Proxying external request to: ${targetUrl}${pathRewrite(req.url)}`);
                    } else {
                        // 内部请求代理到目标 URL
                        pathRewrite = (path: string) => path;
                        _outputChannel?.appendLine(`Proxying internal request to: ${targetUrl}${req.url}`);
                    }
                } catch (e) {
                    _outputChannel?.appendLine(`Error parsing URL: ${e}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid URL');
                    return;
                }
            }

            proxyServer.web(req, res, {
                target: targetUrl,
                changeOrigin: true,
                pathRewrite: pathRewrite,
                secure: false,
                ws: true
            });
        });

        httpServer.listen(_proxyPort, 'localhost', () => {
            _outputChannel?.appendLine(`Content proxy server listening on http://localhost:${_proxyPort}`);
            resolve();
        });

        httpServer.on('error', (err: Error) => {
            _outputChannel?.appendLine(`Content proxy server startup error: ${err.message}`);
            vscode.window.showErrorMessage(`内容代理服务器启动失败: ${err.message}`);
            reject(err);
        });
    });
}

export function stopContentProxy() {
    if (httpServer) {
        httpServer.close(() => {
            _outputChannel?.appendLine('Content proxy server closed.');
        });
        httpServer = undefined;
    }
    if (proxyServer) {
        proxyServer.close(() => {
            _outputChannel?.appendLine('HTTP proxy instance closed.');
        });
        proxyServer = undefined;
    }
} 