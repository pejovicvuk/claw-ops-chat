#!/usr/bin/env bash
# PreToolUse hook: block git push to main/master branches
# Exit 2 = block, Exit 0 = allow

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      process.stdout.write(j.tool_input?.command || '');
    }catch{process.exit(0)}
  });
")

if echo "$COMMAND" | grep -qE 'git\s+push\s+.*\b(main|master)\b'; then
  echo "BLOCKED: Direct push to main/master is not allowed. Use a feature branch and PR." >&2
  exit 2
fi

exit 0
