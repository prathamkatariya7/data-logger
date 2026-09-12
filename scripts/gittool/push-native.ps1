# Native-git push using curl (Windows Schannel / cert store) for the API calls.
# Token comes from $env:GITHUB_TOKEN. Repo name arg1 (default data-logger).
$ErrorActionPreference = 'Stop'
$gitCmd = Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'
if (-not (Test-Path $gitCmd)) { $gitCmd = 'git' }
$repo = if ($args[0]) { $args[0] } else { 'data-logger' }
$tok  = $env:GITHUB_TOKEN
if (-not $tok) { throw 'GITHUB_TOKEN not set' }
$dir  = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$hdrAuth = "Authorization: Bearer $tok"
$hdrAcc  = 'Accept: application/vnd.github+json'
$hdrUA   = 'User-Agent: coco'

# 1. Identify the token owner.
$meJson = curl.exe -sS -H $hdrAuth -H $hdrAcc -H $hdrUA https://api.github.com/user
$login = ($meJson | ConvertFrom-Json).login
if (-not $login) { throw "could not read login from /user: $meJson" }
Write-Host "authenticated as: $login"

# 2. Create the repo (ignore 'already exists').
$body = '{"name":"' + $repo + '","private":true,"description":"Data Logger dashboard + calibration server"}'
$code = curl.exe -sS -o "$env:TEMP\ghcreate.json" -w "%{http_code}" -X POST -H $hdrAuth -H $hdrAcc -H $hdrUA -H "Content-Type: application/json" -d $body https://api.github.com/user/repos
Write-Host "create repo http: $code"
if ($code -ne '201' -and $code -ne '422') { throw ("repo create failed: " + (Get-Content "$env:TEMP\ghcreate.json" -Raw)) }
if ($code -eq '422') { Write-Host "(repo already exists - will push into it)" }

# 3. Use Windows cert store for TLS (handles corporate proxy interception).
& $gitCmd -C $dir config http.sslBackend schannel

# 4. Set a clean origin remote (no token in it) for future native-git use.
& $gitCmd -C $dir remote remove origin 2>$null
& $gitCmd -C $dir remote add origin "https://github.com/$login/$repo.git"

# 5. Push main using a one-shot tokenized URL (not persisted anywhere).
& $gitCmd -C $dir push "https://x-access-token:$tok@github.com/$login/$repo.git" main:main
if ($LASTEXITCODE -ne 0) { throw "git push failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "SUCCESS -> https://github.com/$login/$repo"
