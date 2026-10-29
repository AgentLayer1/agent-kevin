# Claude with subscription segmentation
function agent {
  $s = Join-Path $PWD '.state/secrets/.env.claude.json'
  if (Test-Path $s) { claude --settings $s @args } else { claude @args }
}
