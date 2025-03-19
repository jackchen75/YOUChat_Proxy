#!/bin/bash
set -e

# 启动Xvfb
Xvfb :99 -screen 0 1280x1024x24 &

# 执行命令
exec "$@"
