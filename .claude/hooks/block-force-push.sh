#!/usr/bin/env bash
# PreToolUse hook: block git force-push
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

if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--(force|force-with-lease)'; then
  echo "BLOCKED: Force push is not allowed." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git\s+push\s+-[a-zA-Z]*f'; then
  echo "BLOCKED: Force push (-f) is not allowed." >&2
  exit 2
fi

exit 0
