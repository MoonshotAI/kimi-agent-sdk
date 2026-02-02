@echo off
set "SCRIPT_DIR=%~dp0"
set "UV_ROOT=%SCRIPT_DIR%..\uv"
set "UV_CACHE_DIR=%UV_ROOT%\cache"
set "UV_TOOL_DIR=%UV_ROOT%\tools"
set "UV_PYTHON_INSTALL_DIR=%UV_ROOT%\python"
"%UV_ROOT%\bin\uvx.exe" kimi-cli %*
