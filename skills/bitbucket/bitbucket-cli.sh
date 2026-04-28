#!/bin/bash
set -euo pipefail

# ============================================================================
# bitbucket-cli.sh — Bitbucket Cloud REST API wrapper (read-only)
#
# Dependencies: curl, python3
# Env vars: ATLASSIAN_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE
# Auth: Basic auth with email + read-only scoped API token
# Outputs: JSON to stdout, errors to stderr
# ============================================================================

for var in ATLASSIAN_EMAIL BITBUCKET_API_TOKEN BITBUCKET_WORKSPACE; do
    if [ -z "${!var:-}" ]; then
        echo "{\"error\": \"Missing env var: $var\"}" >&2
        exit 1
    fi
done

AUTH="$ATLASSIAN_EMAIL:$BITBUCKET_API_TOKEN"
BASE="https://api.bitbucket.org/2.0"
WS="$BITBUCKET_WORKSPACE"

# --- Retry wrapper for curl ---
retry_curl() {
    local max_retries=3
    local attempt=0
    local backoff=2
    local response http_code body curl_exit

    while [ "$attempt" -lt "$max_retries" ]; do
        attempt=$((attempt + 1))
        curl_exit=0
        response=$(curl -s -w "\n%{http_code}" "$@" 2>/dev/null) || curl_exit=$?

        if [ "$curl_exit" -ne 0 ]; then
            if [ "$attempt" -lt "$max_retries" ]; then
                echo "curl connection error (exit $curl_exit), retrying in ${backoff}s... (attempt $attempt/$max_retries)" >&2
                sleep "$backoff"
                backoff=$((backoff * 2))
                continue
            else
                echo "{\"error\": \"curl connection failed after $max_retries attempts (exit code $curl_exit)\"}" >&2
                return 1
            fi
        fi

        http_code=$(echo "$response" | tail -1)
        body=$(echo "$response" | sed '$d')

        # Don't retry client errors (not transient)
        if [ "$http_code" -ge 400 ] && [ "$http_code" -lt 500 ] && [ "$http_code" -ne 429 ]; then
            echo "$body"
            echo "$http_code"
            return 0
        fi

        # Retry on 429 (rate limit)
        if [ "$http_code" -eq 429 ]; then
            if [ "$attempt" -lt "$max_retries" ]; then
                # Try to parse Retry-After from response headers; fall back to backoff
                local retry_after="$backoff"
                local header_val
                header_val=$(curl -s -I "$@" 2>/dev/null | grep -i "^retry-after:" | head -1 | tr -d '\r' | awk '{print $2}')
                if [ -n "$header_val" ] && [ "$header_val" -gt 0 ] 2>/dev/null; then
                    retry_after="$header_val"
                fi
                echo "Rate limited (429), retrying in ${retry_after}s... (attempt $attempt/$max_retries)" >&2
                sleep "$retry_after"
                backoff=$((backoff * 2))
                continue
            fi
        fi

        # Retry on server errors
        if [ "$http_code" -ge 500 ]; then
            if [ "$attempt" -lt "$max_retries" ]; then
                echo "Server error (HTTP $http_code), retrying in ${backoff}s... (attempt $attempt/$max_retries)" >&2
                sleep "$backoff"
                backoff=$((backoff * 2))
                continue
            fi
        fi

        # Success or final attempt
        echo "$body"
        echo "$http_code"
        return 0
    done

    # Should not reach here, but just in case
    echo "$body"
    echo "$http_code"
    return 0
}

# --- HTTP helpers ---
bb_get() {
    local response http_code body
    response=$(retry_curl -u "$AUTH" -H "Accept: application/json" "$1")
    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -ge 400 ]; then
        local snippet
        snippet=$(echo "$body" | head -c 300)
        local err="{\"error\": \"HTTP $http_code\", \"url\": \"$1\", \"detail\": \"$snippet\"}"
        echo "$err" >&2
        echo "$err"
        exit 1
    fi
    echo "$body"
}

bb_get_raw() {
    local http_code body
    body=$(retry_curl -u "$AUTH" "$1")
    http_code=$(echo "$body" | tail -1)
    body=$(echo "$body" | sed '$d')
    if [ "$http_code" -ge 400 ]; then
        local snippet
        snippet=$(echo "$body" | head -c 300)
        local err="{\"error\": \"HTTP $http_code\", \"url\": \"$1\", \"detail\": \"$snippet\"}"
        echo "$err" >&2
        echo "$err"
        exit 1
    fi
    echo "$body"
}

urlencode() {
    python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"
}

# --- Commands ---

cmd_repos() {
    bb_get "$BASE/repositories/$WS?pagelen=50" | python3 -c "
import sys,json
d=json.load(sys.stdin)
out=[{
    'slug':r.get('slug'),
    'name':r.get('name'),
    'full_name':r.get('full_name'),
    'language':r.get('language'),
    'updated':r.get('updated_on'),
    'is_private':r.get('is_private'),
    'url':r.get('links',{}).get('html',{}).get('href')
} for r in d.get('values',[])]
result={'repos':out}
if d.get('next'):
    result['truncated']=True
    result['note']='More repos exist. Only showing first 50.'
print(json.dumps(result,indent=2))
"
}

cmd_prs() {
    local repo="${1:?Usage: bitbucket-cli.sh prs REPO [STATE]}"
    local state="${2:-OPEN}"
    local encoded_repo
    encoded_repo=$(urlencode "$repo")
    bb_get "$BASE/repositories/$WS/$encoded_repo/pullrequests?state=$state&pagelen=25" | python3 -c "
import sys,json
d=json.load(sys.stdin)
result={
    'total':d.get('size',len(d.get('values',[]))),
    'pullrequests':[{
        'id':pr.get('id'),
        'title':pr.get('title'),
        'author':(pr.get('author')or{}).get('display_name'),
        'source':(pr.get('source')or{}).get('branch',{}).get('name'),
        'destination':(pr.get('destination')or{}).get('branch',{}).get('name'),
        'state':pr.get('state'),
        'created':pr.get('created_on'),
        'updated':pr.get('updated_on'),
        'url':(pr.get('links')or{}).get('html',{}).get('href')
    } for pr in d.get('values',[])
]}
if d.get('next'):
    result['truncated']=True
    result['note']='More pull requests exist. Only showing first 25.'
print(json.dumps(result,indent=2))
"
}

cmd_pr() {
    local repo="${1:?Usage: bitbucket-cli.sh pr REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh pr REPO PR_ID}"
    local encoded_repo encoded_pr_id
    encoded_repo=$(urlencode "$repo")
    encoded_pr_id=$(urlencode "$pr_id")
    bb_get "$BASE/repositories/$WS/$encoded_repo/pullrequests/$encoded_pr_id" | python3 -c "
import sys,json
pr=json.load(sys.stdin)
print(json.dumps({
    'id':pr.get('id'),
    'title':pr.get('title'),
    'description':pr.get('description'),
    'author':(pr.get('author')or{}).get('display_name'),
    'source':(pr.get('source')or{}).get('branch',{}).get('name'),
    'destination':(pr.get('destination')or{}).get('branch',{}).get('name'),
    'state':pr.get('state'),
    'reviewers':[r.get('display_name') for r in pr.get('reviewers',[])],
    'created':pr.get('created_on'),
    'updated':pr.get('updated_on'),
    'comment_count':pr.get('comment_count'),
    'url':(pr.get('links')or{}).get('html',{}).get('href')
},indent=2))
"
}

cmd_diffstat() {
    local repo="${1:?Usage: bitbucket-cli.sh diffstat REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh diffstat REPO PR_ID}"
    local encoded_repo encoded_pr_id
    encoded_repo=$(urlencode "$repo")
    encoded_pr_id=$(urlencode "$pr_id")
    bb_get "$BASE/repositories/$WS/$encoded_repo/pullrequests/$encoded_pr_id/diffstat" | python3 -c "
import sys,json
d=json.load(sys.stdin)
files=[]
for f in d.get('values',[]):
    old_path=(f.get('old')or{}).get('path')
    new_path=(f.get('new')or{}).get('path')
    files.append({
        'path':new_path or old_path,
        'status':f.get('status'),
        'lines_added':f.get('lines_added',0),
        'lines_removed':f.get('lines_removed',0)
    })
total_added=sum(x['lines_added'] for x in files)
total_removed=sum(x['lines_removed'] for x in files)
print(json.dumps({
    'files_changed':len(files),
    'total_added':total_added,
    'total_removed':total_removed,
    'files':files
},indent=2))
"
}

cmd_diff() {
    local repo="${1:?Usage: bitbucket-cli.sh diff REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh diff REPO PR_ID}"
    local encoded_repo encoded_pr_id
    encoded_repo=$(urlencode "$repo")
    encoded_pr_id=$(urlencode "$pr_id")
    bb_get_raw "$BASE/repositories/$WS/$encoded_repo/pullrequests/$encoded_pr_id/diff"
}

cmd_comments() {
    local repo="${1:?Usage: bitbucket-cli.sh comments REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh comments REPO PR_ID}"
    local encoded_repo encoded_pr_id
    encoded_repo=$(urlencode "$repo")
    encoded_pr_id=$(urlencode "$pr_id")
    bb_get "$BASE/repositories/$WS/$encoded_repo/pullrequests/$encoded_pr_id/comments?pagelen=50" | python3 -c "
import sys,json
d=json.load(sys.stdin)
comments=[]
for c in d.get('values',[]):
    inline=c.get('inline')
    loc=None
    if inline:
        loc={'path':inline.get('path'),'from':inline.get('from'),'to':inline.get('to')}
    content=c.get('content',{}).get('raw','')
    comments.append({
        'id':c.get('id'),
        'author':(c.get('user')or{}).get('display_name'),
        'content':content[:500] if content else None,
        'inline':loc,
        'created':c.get('created_on')
    })
result={'count':len(comments),'comments':comments}
if d.get('next'):
    result['truncated']=True
    result['note']='More comments exist. Only showing first 50.'
print(json.dumps(result,indent=2))
"
}

cmd_pr_commits() {
    local repo="${1:?Usage: bitbucket-cli.sh pr-commits REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh pr-commits REPO PR_ID}"
    local encoded_repo encoded_pr_id
    encoded_repo=$(urlencode "$repo")
    encoded_pr_id=$(urlencode "$pr_id")
    bb_get "$BASE/repositories/$WS/$encoded_repo/pullrequests/$encoded_pr_id/commits?pagelen=25" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(json.dumps([{
    'hash':c.get('hash','')[:12],
    'message':(c.get('message')or'').split('\n')[0],
    'author':(c.get('author')or{}).get('raw'),
    'date':c.get('date')
} for c in d.get('values',[])],indent=2))
"
}

cmd_branches() {
    local repo="${1:?Usage: bitbucket-cli.sh branches REPO [filter]}"
    local filter="${2:-}"
    local encoded_repo
    encoded_repo=$(urlencode "$repo")
    local url="$BASE/repositories/$WS/$encoded_repo/refs/branches?pagelen=25"
    if [ -n "$filter" ]; then
        url="$url&q=name~\"$filter\""
    fi
    bb_get "$url" | python3 -c "
import sys,json
d=json.load(sys.stdin)
out=[{
    'name':b.get('name'),
    'hash':(b.get('target')or{}).get('hash','')[:12],
    'date':(b.get('target')or{}).get('date'),
    'author':((b.get('target')or{}).get('author')or{}).get('raw')
} for b in d.get('values',[])]
result={'branches':out}
if d.get('next'):
    result['truncated']=True
    result['note']='More branches exist. Only showing first 25.'
print(json.dumps(result,indent=2))
"
}

cmd_commits() {
    local repo="${1:?Usage: bitbucket-cli.sh commits REPO [BRANCH]}"
    local branch="${2:-main}"
    local encoded_repo encoded_branch
    encoded_repo=$(urlencode "$repo")
    encoded_branch=$(urlencode "$branch")
    bb_get "$BASE/repositories/$WS/$encoded_repo/commits/$encoded_branch?pagelen=10" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(json.dumps([{
    'hash':c.get('hash','')[:12],
    'message':(c.get('message')or'').split('\n')[0],
    'author':(c.get('author')or{}).get('raw'),
    'date':c.get('date')
} for c in d.get('values',[])],indent=2))
"
}

cmd_file() {
    local repo="${1:?Usage: bitbucket-cli.sh file REPO FILEPATH [REV]}"
    local filepath="${2:?Usage: bitbucket-cli.sh file REPO FILEPATH [REV]}"
    local rev="${3:-main}"
    bb_get_raw "$BASE/repositories/$WS/$repo/src/$rev/$filepath"
}

cmd_ls() {
    local repo="${1:?Usage: bitbucket-cli.sh ls REPO [PATH] [REV]}"
    local path="${2:-}"
    local rev="${3:-main}"
    bb_get "$BASE/repositories/$WS/$repo/src/$rev/$path" | python3 -c "
import sys,json
d=json.load(sys.stdin)
entries=[]
for v in d.get('values',[]):
    entries.append({
        'path':v.get('path'),
        'type':v.get('type'),
        'size':v.get('size')
    })
print(json.dumps(entries,indent=2))
"
}

cmd_tree() {
    local repo="${1:?Usage: bitbucket-cli.sh tree REPO [PATH] [REV]}"
    local path="${2:-}"
    local rev="${3:-main}"
    local url="$BASE/repositories/$WS/$repo/src/$rev/$path?max_depth=100&pagelen=100"
    bb_get "$url" | python3 -c "
import sys,json
d=json.load(sys.stdin)
entries=[]
for v in d.get('values',[]):
    t='d' if v.get('type')=='commit_directory' else 'f'
    entries.append((v.get('path',''),t))
entries.sort(key=lambda x:x[0])
for path,t in entries:
    print(f'{t} {path}')
"
}

cmd_search() {
    local query="${1:?Usage: bitbucket-cli.sh search QUERY [REPO]}"
    local repo="${2:-}"
    local encoded_query
    encoded_query=$(urlencode "$query")
    local url="$BASE/search/code?search_query=$encoded_query&pagelen=10"
    if [ -n "$repo" ]; then
        url="$url&search_in=$WS/$repo"
    fi
    bb_get "$url" | python3 -c "
import sys,json
d=json.load(sys.stdin)
results=[]
for v in d.get('values',[]):
    f=v.get('file',{})
    results.append({
        'file':f.get('path'),
        'repo':(f.get('links',{}).get('self',{}).get('href','').split('/src/')[0].split('/')[-1] if f.get('links') else None),
        'matched_lines':len(v.get('content_matches',[]))
    })
result={'results':results,'showing':len(results)}
if len(results)==d.get('pagelen',10):
    result['note']='Results may be truncated. Refine your query for more specific results.'
print(json.dumps(result,indent=2))
"
}

cmd_compare() {
    local repo="${1:?Usage: bitbucket-cli.sh compare REPO BASE_REF HEAD_REF}"
    local base_ref="${2:?Usage: bitbucket-cli.sh compare REPO BASE_REF HEAD_REF}"
    local head_ref="${3:?Usage: bitbucket-cli.sh compare REPO BASE_REF HEAD_REF}"
    bb_get_raw "$BASE/repositories/$WS/$repo/diff/$base_ref..$head_ref"
}

cmd_build_status() {
    local repo="${1:?Usage: bitbucket-cli.sh build-status REPO COMMIT_HASH}"
    local commit="${2:?Usage: bitbucket-cli.sh build-status REPO COMMIT_HASH}"
    bb_get "$BASE/repositories/$WS/$repo/commit/$commit/statuses?pagelen=25" | python3 -c "
import sys,json
d=json.load(sys.stdin)
statuses=[]
for s in d.get('values',[]):
    statuses.append({
        'name':s.get('name'),
        'state':s.get('state'),
        'url':s.get('url'),
        'created':s.get('created_on')
    })
print(json.dumps(statuses,indent=2))
"
}

cmd_pr_status() {
    local repo="${1:?Usage: bitbucket-cli.sh pr-status REPO PR_ID}"
    local pr_id="${2:?Usage: bitbucket-cli.sh pr-status REPO PR_ID}"
    # Get PR details
    local pr_json
    pr_json=$(bb_get "$BASE/repositories/$WS/$repo/pullrequests/$pr_id")
    # Extract source branch HEAD commit hash and build the result
    echo "$pr_json" | python3 -c "
import sys,json,subprocess
pr=json.load(sys.stdin)
source_hash=((pr.get('source')or{}).get('commit')or{}).get('hash','')
pr_details={
    'id':pr.get('id'),
    'title':pr.get('title'),
    'author':(pr.get('author')or{}).get('display_name'),
    'source':(pr.get('source')or{}).get('branch',{}).get('name'),
    'destination':(pr.get('destination')or{}).get('branch',{}).get('name'),
    'state':pr.get('state'),
    'created':pr.get('created_on'),
    'updated':pr.get('updated_on'),
    'url':(pr.get('links')or{}).get('html',{}).get('href'),
    'source_commit':source_hash[:12] if source_hash else None
}
print(json.dumps(pr_details))
" > /tmp/bb_pr_details_$$.json

    local pr_details
    pr_details=$(cat /tmp/bb_pr_details_$$.json)

    # Get the source commit hash from PR details
    local source_commit
    source_commit=$(echo "$pr_details" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('source_commit') or '')")

    local build_json="[]"
    if [ -n "$source_commit" ]; then
        build_json=$(bb_get "$BASE/repositories/$WS/$repo/commit/$source_commit/statuses?pagelen=25" | python3 -c "
import sys,json
d=json.load(sys.stdin)
statuses=[]
for s in d.get('values',[]):
    statuses.append({
        'name':s.get('name'),
        'state':s.get('state'),
        'url':s.get('url'),
        'created':s.get('created_on')
    })
print(json.dumps(statuses))
")
    fi

    # Combine PR details with build statuses
    python3 -c "
import sys,json
pr_details=json.loads(sys.argv[1])
build_statuses=json.loads(sys.argv[2])
pr_details['build_statuses']=build_statuses
# Determine merge readiness
all_passing=all(s.get('state')=='SUCCESSFUL' for s in build_statuses) if build_statuses else False
pr_details['merge_ready']=pr_details.get('state')=='OPEN' and all_passing
print(json.dumps(pr_details,indent=2))
" "$pr_details" "$build_json"

    rm -f /tmp/bb_pr_details_$$.json
}

# --- Dispatch ---
CMD="${1:-help}"; shift || true
case "$CMD" in
    repos)         cmd_repos;;
    prs)           cmd_prs "$@";;
    pr)            cmd_pr "$@";;
    diffstat)      cmd_diffstat "$@";;
    diff)          cmd_diff "$@";;
    comments)      cmd_comments "$@";;
    pr-commits)    cmd_pr_commits "$@";;
    branches)      cmd_branches "$@";;
    commits)       cmd_commits "$@";;
    file)          cmd_file "$@";;
    ls)            cmd_ls "$@";;
    tree)          cmd_tree "$@";;
    search)        cmd_search "$@";;
    compare)       cmd_compare "$@";;
    build-status)  cmd_build_status "$@";;
    pr-status)     cmd_pr_status "$@";;
    help|--help|-h)
        echo "Usage: bitbucket-cli.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  repos                          List all repos in workspace"
        echo "  prs REPO [STATE]               List pull requests (OPEN/MERGED/DECLINED)"
        echo "  pr REPO PR_ID                  Get PR details"
        echo "  diffstat REPO PR_ID            Per-file change summary"
        echo "  diff REPO PR_ID                Full unified diff"
        echo "  comments REPO PR_ID            PR comments (inline + general)"
        echo "  pr-commits REPO PR_ID          Commits in a PR"
        echo "  branches REPO [filter]         List branches"
        echo "  commits REPO [BRANCH]          Recent commits on a branch"
        echo "  file REPO FILEPATH [REV]       Read file contents"
        echo "  ls REPO [PATH] [REV]           List directory contents"
        echo "  tree REPO [PATH] [REV]         Recursive directory listing"
        echo "  search QUERY [REPO]            Search code in workspace or repo"
        echo "  compare REPO BASE HEAD         Diff between two branches"
        echo "  build-status REPO COMMIT       CI/CD build statuses for a commit"
        echo "  pr-status REPO PR_ID           PR details + build status + merge readiness"
        echo ""
        echo "Env: ATLASSIAN_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE";;
    *) echo "{\"error\":\"Unknown command: $CMD\"}" >&2; exit 1;;
esac
