#!/usr/bin/env bash
# PostToolUse hook: auto-format edited file with Prettier

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const p=j.tool_input?.file_path || j.tool_input?.path || '';
      process.stdout.write(p);
    }catch{process.exit(0)}
  });
")

if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs|css|json|md)$ ]]; then
  npx prettier --write "$FILE_PATH" 2>/dev/null || true
fi

exit 0
