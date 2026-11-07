# Render Keep-Awake Pinger
# Pings the backend health endpoint every 10 minutes to prevent free-tier spin-down.

$url = "https://public-samachar-api.onrender.com/api/health"
Write-Host "Starting Render Keep-Awake Pinger for $url"
Write-Host "Press Ctrl+C to stop."
Write-Host "--------------------------------------------------"

while ($true) {
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15
        Write-Host "$(Get-Date): Ping successful! Status: $($response.status)"
    } catch {
        Write-Host "$(Get-Date): Ping failed. Error: $_"
    }
    # Sleep for 10 minutes (600 seconds)
    Start-Sleep -Seconds 600
}
