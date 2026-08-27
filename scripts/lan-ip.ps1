# Prints the laptop's primary LAN IPv4 address (for the shareable link).
$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.PrefixOrigin -ne 'WellKnown'
  } |
  Sort-Object -Property @{ Expression = { $_.InterfaceAlias -like 'Wi-Fi*' }; Descending = $true } |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($ip) { Write-Output $ip }
