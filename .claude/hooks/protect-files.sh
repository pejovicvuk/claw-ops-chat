#!/usr/bin/env bash
# PreToolUse hook: block writes to protected files
# Exit 2 = block, Exit 0 = allow

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

BLOCKED=(".env" "package-lock.json" ".credentials.json")
BASENAME=$(basename "$FILE_PATH")

for pattern in "${BLOCKED[@]}"; do
  if [[ "$BASENAME" == "$pattern" ]]; then
    echo "BLOCKED: Cannot edit protected file: $BASENAME" >&2
    exit 2
  fi
done

exit 0
