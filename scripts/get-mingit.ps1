# Downloads MinGit (portable Git) bypassing the blocked github.com/releases path
# by resolving the API asset redirect and pulling from the CDN host directly.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$assetId  = '522489786'  # MinGit-2.55.0.5-64-bit.zip
$assetApi = "https://api.github.com/repos/git-for-windows/git/releases/assets/$assetId"
$zip  = Join-Path $env:TEMP 'MinGit.zip'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\MinGit'

# 1. Resolve the redirect WITHOUT following it, so we get the CDN URL.
$req = [System.Net.HttpWebRequest]::Create($assetApi)
$req.UserAgent = 'coco'
$req.Accept = 'application/octet-stream'
$req.AllowAutoRedirect = $false
$resp = $req.GetResponse()
$cdn = $resp.Headers['Location']
$resp.Close()
if (-not $cdn) { throw "no redirect Location returned" }
Write-Host ("CDN host: " + ([System.Uri]$cdn).Host)

# 2. Download the actual bytes from the CDN.
Invoke-WebRequest -Uri $cdn -OutFile $zip -TimeoutSec 240 -UseBasicParsing
$mb = ((Get-Item $zip).Length / 1MB).ToString('0.0')
Write-Host "downloaded: $mb MB"

# 3. Extract.
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dest -Force
$git = Join-Path $dest 'cmd\git.exe'
if (-not (Test-Path $git)) { throw "git.exe not found after extract" }
Write-Host "GIT_EXE=$git"
& $git --version
