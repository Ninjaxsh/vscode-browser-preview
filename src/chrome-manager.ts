import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';

let chromeProcess: cp.ChildProcess | undefined;
let chromeDebugPort = 9222;
let _extensionContext: vscode.ExtensionContext | undefined;
let _outputChannel: vscode.OutputChannel | undefined;

export function initializeChromeManager(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    _extensionContext = context;
    _outputChannel = outputChannel;
}

export async function launchChrome(chromePath: string, targetUrl: string): Promise<string | undefined> {
    if (chromeProcess) {
        _outputChannel?.appendLine('Killing existing Chrome process...');
        chromeProcess.kill('SIGKILL');
        chromeProcess = undefined;
    }

    if (!_extensionContext || !_outputChannel) {
        vscode.window.showErrorMessage('Chrome manager not initialized.');
        return undefined;
    }

    const userDataDir = path.join(_extensionContext.globalStoragePath, 'chrome-debug-profile');
    const args = [
        `--remote-debugging-port=${chromeDebugPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-insecure-localhost', // 允许不安全的 localhost 连接
        '--remote-allow-origins=*',
        '--headless=new', // 重新启用无头模式
        targetUrl // 启动时直接打开目标 URL
    ];

    try {
        _outputChannel.appendLine(`Launching Chrome from ${chromePath} with args: ${args.join(' ')}`);
        chromeProcess = cp.spawn(chromePath, args);

        chromeProcess.stdout?.on('data', (data) => {
            _outputChannel?.appendLine(`Chrome stdout: ${data}`);
        });

        chromeProcess.stderr?.on('data', (data) => {
            _outputChannel?.appendLine(`Chrome stderr: ${data}`);
        });

        chromeProcess.on('error', (err) => {
            _outputChannel?.appendLine(`Chrome process error: ${err.message}`);
            vscode.window.showErrorMessage(`Chrome 后台进程错误: ${err.message}`);
            chromeProcess = undefined;
        });

        chromeProcess.on('exit', (code, signal) => {
            _outputChannel?.appendLine(`Chrome process exited with code ${code}, signal ${signal}`);
            chromeProcess = undefined;
        });

        // Wait for the remote debugging port to be ready
        return new Promise<string | undefined>((resolve) => {
            let retries = 0;
            const maxRetries = 60; // Increased retries
            const retryInterval = 200; // milliseconds

            const checkDebugPort = () => {
                require('http').get(`http://localhost:${chromeDebugPort}/json/version`, (res: any) => {
                    let data = '';
                    res.on('data', (chunk: string) => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            const webSocketDebuggerUrl = json.webSocketDebuggerUrl;
                            if (webSocketDebuggerUrl) {
                                _outputChannel?.appendLine(`Chrome remote debugging ready: ${webSocketDebuggerUrl}`);
                                resolve(webSocketDebuggerUrl);
                            } else if (retries < maxRetries) {
                                retries++;
                                setTimeout(checkDebugPort, retryInterval);
                            } else {
                                _outputChannel?.appendLine('Failed to get webSocketDebuggerUrl after retries.');
                                resolve(undefined);
                            }
                        } catch (e) {
                            _outputChannel?.appendLine(`Failed to parse Chrome version JSON: ${e}`);
                            if (retries < maxRetries) {
                                retries++;
                                setTimeout(checkDebugPort, retryInterval);
                            } else {
                                _outputChannel?.appendLine('Failed to parse Chrome version JSON after retries.');
                                resolve(undefined);
                            }
                        }
                    });
                }).on('error', (err: Error) => {
                    _outputChannel?.appendLine(`Failed to connect to Chrome debug port: ${err.message}`);
                    if (retries < maxRetries) {
                        retries++;
                        setTimeout(checkDebugPort, retryInterval);
                    } else {
                        _outputChannel?.appendLine('Failed to connect to Chrome debug port after retries.');
                        resolve(undefined);
                    }
                });
            };
            checkDebugPort();
        });

    } catch (error) {
        _outputChannel.appendLine(`Failed to launch Chrome: ${error}`);
        vscode.window.showErrorMessage(`启动 Chrome 失败: ${error}`);
        return undefined;
    }
}

export function getChromeDebugPort(): number {
    return chromeDebugPort;
}

export function disposeChrome() {
    if (chromeProcess) {
        _outputChannel?.appendLine('Disposing Chrome process...');
        chromeProcess.kill('SIGKILL');
        chromeProcess = undefined;
    }
} 