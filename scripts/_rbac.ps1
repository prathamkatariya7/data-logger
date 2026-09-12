$b = 'http://127.0.0.1:8092'
$H = 'Content-Type: application/json'
Write-Output '=== admin login ==='
curl.exe -s -c admin.jar -X POST "$b/api/login" -H $H -d '{\"username\":\"admin\",\"password\":\"admin\"}'
Write-Output "`n=== admin lists users ==="
curl.exe -s -b admin.jar "$b/api/users"
Write-Output "`n=== admin creates engineer (pw 'x') ==="
curl.exe -s -b admin.jar -X POST "$b/api/users" -H $H -d '{\"username\":\"eng1\",\"password\":\"x\",\"role\":\"engineer\"}'
Write-Output "`n=== engineer login ==="
curl.exe -s -c eng.jar -X POST "$b/api/login" -H $H -d '{\"username\":\"eng1\",\"password\":\"x\"}'
Write-Output "`n=== engineer GET /api/users (expect 403) ==="
curl.exe -s -o NUL -w "%{http_code}`n" -b eng.jar "$b/api/users"
Write-Output '=== engineer /api/me ==='
curl.exe -s -b eng.jar "$b/api/me"
Write-Output "`n=== engineer creates user (expect 403) ==="
curl.exe -s -o NUL -w "%{http_code}`n" -b eng.jar -X POST "$b/api/users" -H $H -d '{\"username\":\"hax\",\"password\":\"y\",\"role\":\"admin\"}'
Write-Output '=== engineer changes own password ==='
curl.exe -s -b eng.jar -X POST "$b/api/me/password" -H $H -d '{\"current_password\":\"x\",\"new_password\":\"newpass\"}'
Write-Output "`n=== engineer re-login with newpass ==="
curl.exe -s -c eng2.jar -X POST "$b/api/login" -H $H -d '{\"username\":\"eng1\",\"password\":\"newpass\"}'
$engId = (curl.exe -s -b admin.jar "$b/api/users" | ConvertFrom-Json | Where-Object { $_.username -eq 'eng1' }).id
Write-Output "`n=== admin resets eng($engId) password ==="
curl.exe -s -b admin.jar -X POST "$b/api/users/$engId/reset-password" -H $H -d '{\"new_password\":\"reset123\"}'
$adminId = (curl.exe -s -b admin.jar "$b/api/users" | ConvertFrom-Json | Where-Object { $_.username -eq 'admin' }).id
Write-Output "`n=== last-admin delete (expect 400) ==="
curl.exe -s -o NUL -w "%{http_code}`n" -b admin.jar -X DELETE "$b/api/users/$adminId"
Write-Output '=== self-delete same as last-admin here; admin deletes engineer ==='
curl.exe -s -b admin.jar -X DELETE "$b/api/users/$engId"
Write-Output "`n=== ingest open without login (expect 200) ==="
curl.exe -s -o NUL -w "%{http_code}`n" -X POST "$b/api/ingest" -H $H -d '{\"device_id\":\"rbac-sim\",\"pt100\":[{\"ch\":1,\"raw_mV\":42,\"hw_available\":true}]}'
