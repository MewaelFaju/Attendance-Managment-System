# Lets phones and computers on the same Wi-Fi / local network open the Attendance System on this PC.
#
# Must be run as Administrator:
#   Start menu -> type "PowerShell" -> right-click "Windows PowerShell" -> Run as administrator, then:
#   powershell -ExecutionPolicy Bypass -File "<project folder>\scripts\allow-phone-access.ps1"
#
# What it does (nothing else):
#   1. Adds ONE inbound firewall rule for TCP port 3000, only for Private/Domain networks and only
#      from the local subnet (devices on your own network, never the internet).
#   2. If your current network is marked "Public" (Windows blocks incoming connections there), it asks
#      whether to mark it "Private". Say yes only for your own trusted workplace Wi-Fi.
#
# To undo:  Remove-NetFirewallRule -DisplayName "Attendance System (TCP 3000)"
param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'This script needs Administrator rights. Right-click PowerShell -> Run as administrator, then run it again.' -ForegroundColor Red
    exit 1
}

$ruleName = "Attendance System (TCP $Port)"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port `
    -Action Allow -Profile Private, Domain -RemoteAddress LocalSubnet | Out-Null
Write-Host "Firewall rule added: devices on your local network can reach port $Port." -ForegroundColor Green

foreach ($net in (Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })) {
    Write-Host ""
    Write-Host "The network '$($net.Name)' is marked Public, so Windows will still block phones from reaching this PC." -ForegroundColor Yellow
    $answer = Read-Host "Mark '$($net.Name)' as Private? Only do this for your own trusted workplace Wi-Fi (y/N)"
    if ($answer -match '^(y|yes)$') {
        Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Private
        Write-Host "'$($net.Name)' is now Private." -ForegroundColor Green
    } else {
        Write-Host "Left '$($net.Name)' as Public. Phones will not be able to connect until it is Private."
    }
}

Write-Host ""
Write-Host "Done. Start the app (start-server.bat), then open http://localhost:$Port/connect for the phone QR code."
