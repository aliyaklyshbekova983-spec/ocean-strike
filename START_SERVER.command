#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не установлен. Установи Node.js 20+ и запусти файл ещё раз."
  read -n 1
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Устанавливаю зависимости..."
  npm install || { echo "Не удалось установить зависимости."; read -n 1; exit 1; }
fi
npm start
