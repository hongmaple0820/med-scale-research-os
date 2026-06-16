#!/bin/bash
# 文档规范验证脚本
# Usage: bash scripts/validate-docs.sh [file|all]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

check_file() {
  local file="$1"
  local rel_path="${file#E:/project/scale-engine/}"

  # 跳过非 md 文件
  [[ "$file" != *.md ]] && return

  # 跳过特殊文件
  [[ "$file" == *CHANGELOG* ]] && return
  [[ "$file" == *LICENSE* ]] && return

  # 跳过第三方和隐藏目录
  [[ "$file" == *node_modules* ]] && return
  [[ "$file" == *dist* ]] && return
  [[ "$file" == *examples* ]] && return
  [[ "$file" == *tmp* ]] && return
  [[ "$file" == *.*/* ]] && return

  # 检查版本头
  if ! head -10 "$file" | grep -q "Version:"; then
    echo -e "${RED}[FAIL]${NC} $rel_path - 缺少版本头"
    ((ERRORS++))
  fi

  # 检查 localhost 链接
  if grep -q "localhost" "$file" 2>/dev/null; then
    echo -e "${YELLOW}[WARN]${NC} $rel_path - 包含 localhost 链接"
    ((WARNINGS++))
  fi

  # 检查硬编码密钥
  if grep -qE "(password|secret|token|api_key)\s*[:=]\s*['\"][^'\"]+['\"]" "$file" 2>/dev/null; then
    echo -e "${RED}[FAIL]${NC} $rel_path - 可能包含硬编码密钥"
    ((ERRORS++))
  fi

  # 检查代码块是否标注语言（只检查开头的 ```，不检查结尾的 ```）
  if grep -n '^```' "$file" 2>/dev/null | grep -v '```[a-z]' | grep -v '```$' > /dev/null 2>&1; then
    echo -e "${YELLOW}[WARN]${NC} $rel_path - 存在未标注语言的代码块"
    ((WARNINGS++))
  fi
}

if [ "$1" = "all" ]; then
  # 检查所有 md 文件
  while IFS= read -r file; do
    check_file "$file"
  done < <(find E:/project/scale-engine -name "*.md" -not -path "*/node_modules/*" -not -path "*/dist/*")
elif [ -n "$1" ]; then
  check_file "$1"
else
  # 检查最近修改的文件
  echo "Usage: bash scripts/validate-docs.sh [file|all]"
  echo "  file - 检查指定文件"
  echo "  all  - 检查所有文档"
  exit 1
fi

echo ""
echo "========================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ 文档规范检查通过${NC}"
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠️  通过，但有 $WARNINGS 个警告${NC}"
else
  echo -e "${RED}❌ 失败：$ERRORS 个错误，$WARNINGS 个警告${NC}"
  exit 1
fi
