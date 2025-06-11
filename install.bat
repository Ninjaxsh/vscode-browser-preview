@echo off
REM 关闭回显，提高执行的清晰度

pnpm run build & pnpm run pack & code --uninstall-extension charles.vscode-browser-preview & code --install-extension ./vscode-browser-preview-0.0.1.vsix --force

REM 在操作完成后暂停屏幕显示
pause
