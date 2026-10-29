# Claude with subscription segmentation
agent() {
  local s=$PWD/.state/secrets/.env.claude.json
  [[ -f $s ]] && set -- --settings "$s" "$@"
  claude "$@"
}
