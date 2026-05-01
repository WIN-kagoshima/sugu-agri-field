#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$BaseUrl = if ($env:AGRIOPS_BASE_URL) { $env:AGRIOPS_BASE_URL } else { "http://localhost:3001" }
$ReqId = if ($env:AGRIOPS_REQ_ID) { $env:AGRIOPS_REQ_ID } else { "curl-example-$([int][double]::Parse((Get-Date -UFormat %s)))" }

$Headers = @{
    "content-type"     = "application/json"
    "accept"           = "application/json, text/event-stream"
    "x-request-id"     = $ReqId
}

Write-Host "▶ Server card:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$BaseUrl/.well-known/mcp-server.json" | ConvertTo-Json -Depth 5
Write-Host ""

Write-Host "▶ tools/list:" -ForegroundColor Cyan
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/list"; params = @{} } | ConvertTo-Json -Compress
$resp = Invoke-WebRequest -Method Post -Uri "$BaseUrl/mcp" -Headers $Headers -Body $body
Write-Host "X-Request-Id: $($resp.Headers['x-request-id'])"
$resp.Content
Write-Host ""

Write-Host "▶ tools/call get_weather_1km:" -ForegroundColor Cyan
$callBody = @{
    jsonrpc = "2.0"
    id      = 2
    method  = "tools/call"
    params  = @{
        name      = "get_weather_1km"
        arguments = @{ lat = 31.55; lng = 130.55; hours = 24; timezone = "Asia/Tokyo" }
    }
} | ConvertTo-Json -Depth 5 -Compress
$resp = Invoke-WebRequest -Method Post -Uri "$BaseUrl/mcp" -Headers $Headers -Body $callBody
Write-Host "X-Request-Id: $($resp.Headers['x-request-id'])"
$resp.Content.Substring(0, [Math]::Min(2000, $resp.Content.Length))
